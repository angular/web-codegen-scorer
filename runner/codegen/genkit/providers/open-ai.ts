import { ChatMessage } from 'gpt-tokenizer/GptEncoding';
import { GenkitPluginV2 } from 'genkit/plugin';
import { openAI } from '@genkit-ai/compat-oai/openai';
import { RateLimiter } from 'limiter';
import {
  GenkitCloudModelProvider,
  PromptDataForCounting,
  RateLimitConfig,
} from '../model-provider.js';
import o3 from 'gpt-tokenizer/model/o3';
import o4Mini from 'gpt-tokenizer/model/o4-mini';

export class OpenAiModelProvider extends GenkitCloudModelProvider {
  readonly userFacingName = 'Open AI';
  readonly apiKeyVariableName = 'OPENAI_API_KEY';

  protected readonly models = {
    'openai-o3': () => openAI.model('o3'),
    'openai-o4-mini': () => openAI.model('o4-mini'),
    'openai-gpt-5': () => openAI.model('gpt-5'),
  };

  protected rateLimitConfig: Record<string, RateLimitConfig> = {
    // See: https://platform.openai.com/docs/models/o3
    'openai/o3': {
      requestPerMinute: new RateLimiter({
        tokensPerInterval: 500,
        interval: 1000 * 60 * 1.5, // Refresh tokens after 1.5 minutes to be on the safe side.
      }),
      tokensPerMinute: new RateLimiter({
        tokensPerInterval: 30_000 * 0.75, // *0.75 to be more resilient to token count deviations
        interval: 1000 * 60 * 1.5, // Refresh tokens after 1.5 minutes to be on the safe side.
      }),
      countTokens: async (prompt) =>
        o3.countTokens(this.genkitPromptToOpenAi(prompt)),
    },
    // See https://platform.openai.com/docs/models/o4-mini
    'openai/o4-mini': {
      requestPerMinute: new RateLimiter({
        tokensPerInterval: 1000,
        interval: 1000 * 60 * 1.5, // Refresh tokens after 1.5 minutes to be on the safe side.
      }),
      tokensPerMinute: new RateLimiter({
        tokensPerInterval: 100_000 * 0.75, // *0.75 to be more resilient to token count deviations
        interval: 1000 * 60 * 1.5, // Refresh tokens after 1.5 minutes to be on the safe side.
      }),
      countTokens: async (prompt) =>
        o4Mini.countTokens(this.genkitPromptToOpenAi(prompt)),
    },
    // See: https://platform.openai.com/docs/models/gpt-5
    'openai/gpt-5': {
      requestPerMinute: new RateLimiter({
        tokensPerInterval: 500,
        interval: 1000 * 60 * 1.5, // Refresh tokens after 1.5 minutes to be on the safe side.
      }),
      tokensPerMinute: new RateLimiter({
        tokensPerInterval: 30_000 * 0.75, // *0.75 to be more resilient to token count deviations
        interval: 1000 * 60 * 1.5, // Refresh tokens after 1.5 minutes to be on the safe side.
      }),
      // TODO: at the time of writing, the `gpt-tokenizer` doesn't support gpt-5.
      // See https://github.com/niieani/gpt-tokenizer/issues/73
      countTokens: async (prompt) =>
        o3.countTokens(this.genkitPromptToOpenAi(prompt)),
    },
  };

  protected pluginFactory(apiKey: string): GenkitPluginV2 {
    return openAI({ apiKey, maxRetries: 0 });
  }

  private genkitPromptToOpenAi(prompt: PromptDataForCounting): ChatMessage[] {
    const openAiPrompt: string | ChatMessage[] = [];
    for (const part of prompt.messages) {
      for (const c of part.content) {
        openAiPrompt.push({
          role: part.role,
          content: 'media' in c ? c.media.url : c.text,
        });
      }
    }
    return [...openAiPrompt, { content: prompt.prompt }];
  }
}
