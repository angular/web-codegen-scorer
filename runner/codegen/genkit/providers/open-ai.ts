import { GenkitPluginV2 } from 'genkit/plugin';
import { openAI } from '@genkit-ai/compat-oai/openai';
import { RateLimiter } from 'limiter';
import {
  GenkitModelProvider,
  PromptDataForCounting,
  RateLimitConfig,
} from '../model-provider.js';
import { encoding_for_model } from 'tiktoken';

export class OpenAiModelProvider extends GenkitModelProvider {
  readonly apiKeyVariableName = 'OPENAI_API_KEY';

  protected readonly models = {
    'openai-o3': () => openAI.model('o3'),
    'openai-o4-mini': () => openAI.model('o4-mini'),
    'openai-gpt-5': () => openAI.model('gpt-5'),
  };

  private countTokensForModel(
    modelName: Parameters<typeof encoding_for_model>[0],
    prompt: PromptDataForCounting
  ): number {
    const encoding = encoding_for_model(modelName);
    try {
      const messages = this.genkitPromptToOpenAi(prompt);
      const text = messages.map((m) => `${m.role}: ${m.content}`).join('\n');
      const tokens = encoding.encode(text);
      return tokens.length;
    } finally {
      encoding.free();
    }
  }

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
      countTokens: async (prompt) => this.countTokensForModel('gpt-4o', prompt),
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
        this.countTokensForModel('gpt-4o-mini', prompt),
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
      countTokens: async (prompt) => this.countTokensForModel('gpt-5', prompt),
    },
  };

  protected pluginFactory(apiKey: string): GenkitPluginV2 {
    return openAI({ apiKey, maxRetries: 0 });
  }

  getModelSpecificConfig(): object {
    // TODO: Add thinking output for OpenAI
    return {};
  }

  private genkitPromptToOpenAi(
    prompt: PromptDataForCounting
  ): Array<{ role: string; content: string }> {
    const openAiPrompt: Array<{ role: string; content: string }> = [];
    for (const part of prompt.messages) {
      for (const c of part.content) {
        openAiPrompt.push({
          role: part.role,
          content: 'media' in c ? c.media.url : c.text,
        });
      }
    }
    return [...openAiPrompt, { role: 'user', content: prompt.prompt }];
  }
}
