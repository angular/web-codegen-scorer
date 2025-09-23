import {
  DynamicResourceAction,
  GenerateResponse,
  genkit,
  ModelReference,
  ToolAction,
} from 'genkit';
import { GenkitMcpHost, McpServerConfig, createMcpHost } from '@genkit-ai/mcp';
import { GenkitPlugin, GenkitPluginV2 } from 'genkit/plugin';
import { z } from 'zod';
import {
  McpServerOptions,
  LlmConstrainedOutputGenerateRequestOptions,
  LlmConstrainedOutputGenerateResponse,
  LlmRunner,
  LlmGenerateFilesResponse,
  LlmGenerateTextResponse,
  LlmGenerateTextRequestOptions,
  LlmGenerateFilesRequestOptions,
} from '../llm-runner.js';
import { setTimeout } from 'node:timers/promises';
import { callWithTimeout } from '../../utils/timeout.js';
import { logger } from 'genkit/logging';
import { GenkitLogger } from './genkit-logger.js';
import { MODEL_PROVIDERS } from './models.js';
import { UserFacingError } from '../../utils/errors.js';
import {
  GenkitModelProvider,
  PromptDataForCounting,
} from './model-provider.js';
import { ToolLogEntry } from '../../shared-interfaces.js';

const globalLogger = new GenkitLogger();
logger.init(globalLogger);

/** Runner that uses the Genkit API under the hood. */
export class GenkitRunner implements LlmRunner {
  readonly id = 'genkit';
  readonly displayName = 'Genkit';
  readonly hasBuiltInRepairLoop = false;
  private readonly genkitInstance = this.getGenkitInstance();
  private mcpHost: GenkitMcpHost | null = null;
  private toolLogs: ToolLogEntry[] = [];

  async generateConstrained<T extends z.ZodTypeAny = z.ZodTypeAny>(
    options: LlmConstrainedOutputGenerateRequestOptions<T>
  ): Promise<LlmConstrainedOutputGenerateResponse<T>> {
    const result = await this._genkitRequest(options);

    return {
      output: result.output,
      usage: result.usage,
      reasoning: result.reasoning,
    };
  }

  async generateFiles(
    options: LlmGenerateFilesRequestOptions
  ): Promise<LlmGenerateFilesResponse> {
    const requestOptions: LlmConstrainedOutputGenerateRequestOptions = {
      ...options,
      prompt: options.context.combinedPrompt,
      schema: z.object({
        outputFiles: z.array(
          z.object({
            filePath: z
              .string()
              .describe('Name of the file that is being changed'),
            code: z.string().describe('New code of the file'),
          })
        ),
      }),
    };

    const result = await this._genkitRequest(requestOptions);

    return {
      files: result.output.outputFiles || [],
      usage: result.usage,
      reasoning: result.reasoning,
      toolLogs: this.flushToolLogs(),
    };
  }

  flushToolLogs(): ToolLogEntry[] {
    return this.toolLogs.splice(0);
  }

  async generateText(
    options: LlmGenerateTextRequestOptions
  ): Promise<LlmGenerateTextResponse> {
    const result = await this._genkitRequest(options);

    return {
      text: result.text,
      usage: result.usage,
      reasoning: result.reasoning,
      toolLogs: this.flushToolLogs(),
    };
  }

  getSupportedModels(): string[] {
    return MODEL_PROVIDERS.flatMap((p) => p.getSupportedModels());
  }

  private async _genkitRequest(
    options:
      | LlmGenerateTextRequestOptions
      | LlmConstrainedOutputGenerateRequestOptions
  ) {
    const { provider, model } = this.resolveModel(options.model);

    return await rateLimitLLMRequest(
      provider,
      model,
      { messages: options.messages || [], prompt: options.prompt },
      () => {
        const schema = (
          options as Partial<LlmConstrainedOutputGenerateRequestOptions>
        ).schema;
        const performRequest = async () => {
          let tools: ToolAction[] | undefined;
          let resources: DynamicResourceAction[] | undefined;

          if (!options.skipMcp && this.mcpHost) {
            [tools, resources] = await Promise.all([
              this.mcpHost.getActiveTools(this.genkitInstance),
              this.mcpHost.getActiveResources(this.genkitInstance),
            ]);
          }

          const response = await this.genkitInstance.generate({
            prompt: options.prompt,
            model,
            output: schema
              ? {
                  // Note that the schema needs to be cast to `any`, because allowing its type to
                  // be inferred ends up causing `TS2589: Type instantiation is excessively deep and possibly infinite.`,
                  // most likely due to how the Genkit type inferrence is set up. This doesn't affect
                  // the return type since it was already `ZodTypeAny` which coerces to `any`.
                  schema: schema as any,
                  constrained: true,
                }
              : undefined,
            config: provider.getModelSpecificConfig(
              {
                includeThoughts:
                  options.thinkingConfig?.includeThoughts ?? false,
              },
              options.model
            ),
            messages: options.messages,
            tools,
            resources,
            abortSignal: options.abortSignal,
          });

          this._logToolUsage(response);

          return response;
        };

        return options.timeout
          ? callWithTimeout(
              options.timeout.description,
              performRequest,
              options.timeout.durationInMins
            )
          : performRequest();
      }
    );
  }

  private _logToolUsage(response: GenerateResponse<any>) {
    const toolRequests = new Map<string, any>();
    const toolResponses = new Map<string, any>();

    if (response.request?.messages) {
      for (const message of response.request.messages) {
        if (!message.content) {
          continue;
        }
        for (const contentPart of message.content) {
          if (contentPart.toolRequest) {
            toolRequests.set(
              contentPart.toolRequest.ref || '0',
              contentPart.toolRequest
            );
          } else if (contentPart.toolResponse) {
            toolResponses.set(
              contentPart.toolResponse.ref || '0',
              contentPart.toolResponse
            );
          }
        }
      }
    }

    for (const [ref, toolRequest] of toolRequests.entries()) {
      const toolResponse = toolResponses.get(ref);
      if (toolResponse) {
        this.toolLogs.push({
          request: toolRequest,
          response: toolResponse,
        });
      }
    }
  }

  startMcpServerHost(hostName: string, servers: McpServerOptions[]): void {
    if (this.mcpHost !== null) {
      throw new Error('MCP host is already started');
    }

    const mcpServers = servers.reduce(
      (result, current) => {
        const { name, ...config } = current;
        result[name] = config;

        return result;
      },
      {} as Record<string, McpServerConfig>
    );

    globalLogger.startCapturingLogs();
    this.mcpHost = createMcpHost({ name: hostName, mcpServers });
  }

  flushMcpServerLogs(): string[] {
    return globalLogger
      .flushCapturedLogs()
      .filter(
        (log): log is string => typeof log === 'string' && log.includes('[MCP')
      );
  }

  async dispose() {
    try {
      await this.mcpHost?.close();
    } catch (error) {
      console.error(`Failed to close MCP host`, error);
    }
  }

  private resolveModel(name: string) {
    for (const provider of MODEL_PROVIDERS) {
      const model = provider.createModel(name);

      if (model) {
        return { provider: provider as GenkitModelProvider, model };
      }
    }

    throw new UserFacingError(
      `Unrecognized model '${name}'. The configured models are:\n` +
        this.getSupportedModels()
          .map((m) => `- ${m}`)
          .join('\n')
    );
  }

  /** Gets a Genkit instance configured with the currently-available providers. */
  private getGenkitInstance() {
    const plugins: (GenkitPlugin | GenkitPluginV2)[] = [];
    const environmentVars: string[] = [];

    for (const provider of MODEL_PROVIDERS) {
      const plugin = provider.getPlugin();
      environmentVars.push(provider.apiKeyVariableName);

      if (plugin) {
        plugins.push(plugin);
      }
    }

    if (plugins.length === 0) {
      throw new UserFacingError(
        `No LLM providers have been configured. You must set at least one of the ` +
          `following environment variables:\n` +
          environmentVars.map((e) => `- ${e}`).join('\n')
      );
    }

    return genkit({ plugins });
  }
}

/**
 * Invokes the LLM request function with respect to potential model rate limits.
 */
async function rateLimitLLMRequest<T>(
  provider: GenkitModelProvider,
  model: ModelReference<any>,
  prompt: string | PromptDataForCounting,
  requestFn: () => Promise<T>,
  retryCount = 0
): Promise<T> {
  if (typeof prompt === 'string') {
    prompt = { messages: [], prompt };
  }

  provider.rateLimit(prompt, model);

  try {
    return await requestFn();
  } catch (e: unknown) {
    if (typeof e === 'object') {
      // If we know it's a rate-limitation error, re-queue but with a linear backoff.
      if (
        e?.constructor?.name === 'RateLimitError' || // From `openai`
        e?.constructor?.name === 'GoogleGenerativeAIFetchError' // From `Gemini`.
      ) {
        if (retryCount === 10) {
          throw e;
        }
        // Exponential backoff with randomness to avoid retrying at the same times with other requests.
        const backoffSeconds =
          (25 + 10 * 1.35 ** retryCount++) * (0.8 + Math.random() * 0.4);
        await setTimeout(1000 * backoffSeconds);
        return rateLimitLLMRequest(
          provider,
          model,
          prompt,
          requestFn,
          retryCount
        );
      }
    }
    throw e;
  }
}
