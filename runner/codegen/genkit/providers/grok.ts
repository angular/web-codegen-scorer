import { xAI } from '@genkit-ai/compat-oai/xai';
import { GenkitPlugin, GenkitPluginV2 } from 'genkit/plugin';
import { RateLimiter } from 'limiter';
import fetch from 'node-fetch';
import {
  GenkitModelProvider,
  PromptDataForCounting,
  RateLimitConfig,
} from '../model-provider.js';

export class GrokModelProvider extends GenkitModelProvider {
  readonly apiKeyVariableName = 'XAI_API_KEY';

  protected readonly models = {
    'grok-4': () => xAI.model('grok-4'),
    'grok-code-fast-1': () => xAI.model('grok-code-fast-1'),
  };

  private async countTokensWithXaiApi(
    prompt: PromptDataForCounting
  ): Promise<number | null> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return null;
    }

    try {
      // Use xAI's tokenize API for accurate token counting
      const messages = this.genkitPromptToXaiFormat(prompt);
      const text = messages.map((m) => `${m.role}: ${m.content}`).join('\n');

      const response = await fetch('https://api.x.ai/v1/tokenize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ text }),
      });

      if (response.ok) {
        const data = (await response.json()) as { tokens: unknown[] };
        return data.tokens?.length || 0;
      }
      return null;
    } catch (error) {
      console.warn('Failed to count tokens using xAI API', error);
      return null;
    }
  }

  private async countTokensForModel(
    _modelName: string,
    prompt: PromptDataForCounting
  ): Promise<number> {
    const xaiTokenCount = await this.countTokensWithXaiApi(prompt);
    if (xaiTokenCount !== null) {
      return xaiTokenCount;
    }
    return 0;
  }

  protected rateLimitConfig: Record<string, RateLimitConfig> = {
    // XAI Grok rate limits https://docs.x.ai/docs/models
    'xai/grok-4': {
      requestPerMinute: new RateLimiter({
        tokensPerInterval: 480,
        interval: 1000 * 60 * 1.5, // Refresh tokens after 1.5 minutes to be on the safe side
      }),
      tokensPerMinute: new RateLimiter({
        tokensPerInterval: 2_000_000 * 0.75,
        interval: 1000 * 60 * 1.5, // Refresh tokens after 1.5 minutes to be on the safe side
      }),
      countTokens: (prompt) => this.countTokensForModel('grok-4', prompt),
    },
    'xai/grok-code-fast-1': {
      requestPerMinute: new RateLimiter({
        tokensPerInterval: 480,
        interval: 1000 * 60 * 1.5, // Refresh tokens after 1.5 minutes to be on the safe side
      }),
      tokensPerMinute: new RateLimiter({
        tokensPerInterval: 2_000_000 * 0.75,
        interval: 1000 * 60 * 1.5, // Refresh tokens after 1.5 minutes to be on the safe side
      }),
      countTokens: (prompt) =>
        this.countTokensForModel('grok-code-fast-1', prompt),
    },
  };

  protected pluginFactory(apiKey: string): GenkitPlugin | GenkitPluginV2 {
    return xAI({ apiKey });
  }

  getModelSpecificConfig(): object {
    // Grok doesn't require special configuration at this time
    return {};
  }

  private genkitPromptToXaiFormat(
    prompt: PromptDataForCounting
  ): Array<{ role: string; content: string }> {
    const xaiPrompt: Array<{ role: string; content: string }> = [];
    for (const part of prompt.messages) {
      for (const c of part.content) {
        xaiPrompt.push({
          role: part.role,
          content: 'media' in c ? c.media.url : c.text,
        });
      }
    }
    return [...xaiPrompt, { role: 'user', content: prompt.prompt }];
  }
}
