import {AnthropicProviderOptions} from '@ai-sdk/anthropic';
import {GoogleGenerativeAIProviderOptions} from '@ai-sdk/google';
import {OpenAIResponsesProviderOptions} from '@ai-sdk/openai';
import {
  FilePart,
  generateObject,
  generateText,
  LanguageModel,
  ModelMessage,
  SystemModelMessage,
  TextPart,
} from 'ai';
import z from 'zod';
import {combineAbortSignals} from '../../utils/abort-signal.js';
import {callWithTimeout} from '../../utils/timeout.js';
import {
  LlmRunner,
  LocalLlmConstrainedOutputGenerateRequestOptions,
  LocalLlmConstrainedOutputGenerateResponse,
  LocalLlmGenerateFilesRequestOptions,
  LocalLlmGenerateFilesResponse,
  LocalLlmGenerateTextRequestOptions,
  LocalLlmGenerateTextResponse,
  PromptDataMessage,
} from '../llm-runner.js';
import {ANTHROPIC_MODELS, getAiSdkModelOptionsForAnthropic} from './anthropic.js';
import {getAiSdkModelOptionsForGoogle, GOOGLE_MODELS} from './google.js';
import {getAiSdkModelOptionsForOpenAI, OPENAI_MODELS} from './openai.js';

const SUPPORTED_MODELS = [...GOOGLE_MODELS, ...ANTHROPIC_MODELS, ...OPENAI_MODELS] as const;

// Increased to a very high value as we rely on an actual timeout
// that aborts stuck LLM requests. WCS is targeting stability here;
// even if it involves many exponential backoff-waiting.
const DEFAULT_MAX_RETRIES = 100000;

export class AiSDKRunner implements LlmRunner {
  displayName = 'AI SDK';
  id = 'ai-sdk';
  hasBuiltInRepairLoop = true;

  async generateText(
    options: LocalLlmGenerateTextRequestOptions,
  ): Promise<LocalLlmGenerateTextResponse> {
    const response = await this._wrapRequestWithTimeoutAndRateLimiting(options, async abortSignal =>
      generateText({
        ...(await this._getAiSdkModelOptions(options)),
        abortSignal: abortSignal,
        messages: this._convertRequestToMessagesList(options),
        maxRetries: DEFAULT_MAX_RETRIES,
      }),
    );

    return {
      reasoning: response.reasoningText ?? '',
      text: response.text,
      usage: {
        inputTokens: response.usage.inputTokens ?? 0,
        outputTokens: response.usage.outputTokens ?? 0,
        thinkingTokens: response.usage.reasoningTokens ?? 0,
        totalTokens: response.usage.totalTokens ?? 0,
      },
      // TODO: Consider supporting `toolLogs` and MCP here.
    };
  }

  async generateConstrained<T extends z.ZodTypeAny = z.ZodTypeAny>(
    options: LocalLlmConstrainedOutputGenerateRequestOptions<T>,
  ): Promise<LocalLlmConstrainedOutputGenerateResponse<T>> {
    const response = await this._wrapRequestWithTimeoutAndRateLimiting(options, async abortSignal =>
      generateObject({
        ...(await this._getAiSdkModelOptions(options)),
        messages: this._convertRequestToMessagesList(options),
        schema: options.schema,
        abortSignal: abortSignal,
        maxRetries: DEFAULT_MAX_RETRIES,
      }),
    );

    return {
      reasoning: response.reasoning ?? '',
      output: response.object,
      usage: {
        inputTokens: response.usage.inputTokens ?? 0,
        outputTokens: response.usage.outputTokens ?? 0,
        thinkingTokens: response.usage.reasoningTokens ?? 0,
        totalTokens: response.usage.totalTokens ?? 0,
      },
      // TODO: Consider supporting `toolLogs` and MCP here.
    };
  }

  async generateFiles(
    options: LocalLlmGenerateFilesRequestOptions,
  ): Promise<LocalLlmGenerateFilesResponse> {
    const response = await this.generateConstrained({
      ...options,
      prompt: options.context.executablePrompt,
      systemPrompt: options.context.systemInstructions,
      schema: z.object({
        outputFiles: z.array(
          z.object({
            filePath: z.string().describe('Name of the file that is being changed'),
            code: z.string().describe('New code of the file'),
          }),
        ),
      }),
    });

    return {
      files: response.output?.outputFiles ?? [],
      reasoning: response.reasoning,
      usage: response.usage,
      // TODO: Consider supporting `toolLogs` and MCP here.
    };
  }

  getSupportedModels(): string[] {
    return [...SUPPORTED_MODELS];
  }

  async dispose(): Promise<void> {}

  private async _wrapRequestWithTimeoutAndRateLimiting<T>(
    request: LocalLlmGenerateTextRequestOptions | LocalLlmConstrainedOutputGenerateRequestOptions,
    fn: (abortSignal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    // TODO: Check if rate-limiting is actually necessary here. AI SDK
    // seems to do retrying on its own.

    if (request.timeout === undefined) {
      return await fn(request.abortSignal);
    }
    return callWithTimeout(
      request.timeout.description,
      abortSignal => fn(combineAbortSignals(abortSignal, request.abortSignal)),
      request.timeout.durationInMins,
    );
  }

  private async _getAiSdkModelOptions(request: LocalLlmGenerateTextRequestOptions): Promise<{
    model: LanguageModel;
    providerOptions:
      | {anthropic: AnthropicProviderOptions}
      | {google: GoogleGenerativeAIProviderOptions}
      | {openai: OpenAIResponsesProviderOptions};
  }> {
    const result =
      (await getAiSdkModelOptionsForGoogle(request.model)) ??
      (await getAiSdkModelOptionsForAnthropic(request.model)) ??
      (await getAiSdkModelOptionsForOpenAI(request.model));
    if (result === null) {
      throw new Error(`Unexpected unsupported model: ${request.model}`);
    }
    return result;
  }

  private _convertRequestToMessagesList(
    request: LocalLlmConstrainedOutputGenerateRequestOptions | LocalLlmGenerateTextRequestOptions,
  ): ModelMessage[] {
    return [
      // System prompt message.
      ...(request.systemPrompt !== undefined
        ? [
            {
              role: 'system',
              content: request.systemPrompt,
            } satisfies SystemModelMessage,
          ]
        : []),
      // Optional additional messages
      ...this._toAiSDKMessage(request.messages ?? []),
      // The main message.
      {role: 'user', content: [{type: 'text', text: request.prompt}]},
    ];
  }

  private _toAiSDKMessage(messages: PromptDataMessage[]): ModelMessage[] {
    const result: ModelMessage[] = [];

    for (const message of messages) {
      if (message.role === 'model') {
        result.push({
          role: 'assistant',
          content: message.content.map(c =>
            'media' in c
              ? ({type: 'file', data: c.media.url, mediaType: 'image/png'} satisfies FilePart)
              : ({type: 'text', text: c.text} satisfies TextPart),
          ),
        });
      } else if (message.role === 'user') {
        result.push({
          role: 'user',
          content: message.content.map(c =>
            'media' in c
              ? ({type: 'file', data: c.media.url, mediaType: 'image/png'} satisfies FilePart)
              : ({type: 'text', text: c.text} satisfies TextPart),
          ),
        });
      }
    }
    return result;
  }
}
