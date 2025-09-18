import {
  DynamicResourceAction,
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
  GenkitCloudModelProvider,
  GenkitModelProvider,
  PromptDataForCounting,
} from './model-provider.js';

const globalLogger = new GenkitLogger();
logger.init(globalLogger);

/** Runner that uses the Genkit API under the hood. */
export class GenkitRunner implements LlmRunner {
  readonly id = 'genkit';
  readonly displayName = 'Genkit';
  readonly hasBuiltInRepairLoop = false;
  private mcpHost: GenkitMcpHost | null = null;

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
    };
  }

  async generateText(
    options: LlmGenerateTextRequestOptions
  ): Promise<LlmGenerateTextResponse> {
    const result = await this._genkitRequest(options);

    return {
      text: result.text,
      usage: result.usage,
      reasoning: result.reasoning,
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
    const genkitInstance = await this.getGenkitInstance();

    const requestFn = () => {
      const performRequest = async () => {
        let tools: ToolAction[] | undefined;
        let resources: DynamicResourceAction[] | undefined;

        if (!options.skipMcp && this.mcpHost) {
          [tools, resources] = await Promise.all([
            this.mcpHost.getActiveTools(genkitInstance),
            this.mcpHost.getActiveResources(genkitInstance),
          ]);
        }

        const genOpts = provider.getDefaultGenkitGenerateOptions(
          model,
          options
        );

        return genkitInstance.generate({
          ...genOpts,
          tools,
          resources,
        });
      };

      return options.timeout
        ? callWithTimeout(
            options.timeout.description,
            performRequest,
            options.timeout.durationInMins
          )
        : performRequest();
    };

    // We rate-limit only cloud-based LLM providers.
    if (provider instanceof GenkitCloudModelProvider) {
      return await rateLimitLLMRequest(
        provider,
        model,
        {
          messages: options.messages || [],
          prompt: options.prompt,
        },
        requestFn
      );
    }

    return await requestFn();
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
  private async getGenkitInstance() {
    const plugins: (GenkitPlugin | GenkitPluginV2)[] = [];
    const names: string[] = [];

    for (const provider of MODEL_PROVIDERS) {
      const plugin = await provider.getPlugin();
      names.push(provider.userFacingName);

      if (plugin) {
        plugins.push(plugin);
      }
    }

    if (plugins.length === 0) {
      throw new UserFacingError(
        `No LLM providers have been configured. You must set up at least one of the ` +
          `following models:\n` +
          names.map((e) => `- ${e}`).join('\n')
      );
    }

    return genkit({ plugins });
  }
}

/**
 * Invokes the LLM request function with respect to potential model rate limits.
 */
async function rateLimitLLMRequest<T>(
  provider: GenkitCloudModelProvider,
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
