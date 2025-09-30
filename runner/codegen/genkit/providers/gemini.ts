import { GenkitPlugin } from 'genkit/plugin';
import { googleAI } from '@genkit-ai/googleai';
import {
  GenkitModelProvider,
  PromptDataForCounting,
  RateLimitConfig,
} from '../model-provider.js';
import { lazy } from '../../../utils/lazy-creation.js';
import { GoogleGenAI, Part } from '@google/genai';
import { RateLimiter } from 'limiter';
import { LlmResponseFile } from '../../../shared-interfaces.js';

export class GeminiModelProvider extends GenkitModelProvider {
  readonly apiKeyVariableName = 'GEMINI_API_KEY';

  private geminiAPI = lazy(
    () => new GoogleGenAI({ apiKey: this.getApiKey() || undefined })
  );

  protected models = {
    'gemini-2.5-pro': () => googleAI.model('gemini-2.5-pro'),
    'gemini-2.5-flash': () => googleAI.model('gemini-2.5-flash'),
    'gemini-2.5-flash-lite': () => googleAI.model('gemini-2.5-flash-lite'),
  };

  protected rateLimitConfig: Record<string, RateLimitConfig> = {
    // See: https://ai.google.dev/gemini-api/docs/rate-limits#tier-1
    // 150 per minute requests is Gemini Pro's limit right now.
    'googleai/gemini-2.5-pro': {
      requestPerMinute: new RateLimiter({
        tokensPerInterval: 150,
        interval: 1000 * 60 * 1.5, // Refresh tokens after 1.5 minutes to be on the safe side.
      }),
      tokensPerMinute: new RateLimiter({
        tokensPerInterval: 2_000_000 * 0.75, // *0.75 to be more resilient to token count deviations
        interval: 1000 * 60 * 1.5, // Refresh tokens after 1.5 minutes to be on the safe side.
      }),
      countTokens: (prompt) => this.countGeminiTokens(prompt, 'gemini-2.5-pro'),
    },
    // See: https://ai.google.dev/gemini-api/docs/rate-limits#tier-1
    // 1000 per minute requests is Gemini Flash's limit right now.
    'googleai/gemini-2.5-flash': {
      requestPerMinute: new RateLimiter({
        tokensPerInterval: 1000,
        interval: 1000 * 60 * 1.5, // Refresh tokens after 1.5 minutes to be on the safe side.
      }),
      tokensPerMinute: new RateLimiter({
        tokensPerInterval: 1_000_000 * 0.75, // *0.75 to be more resilient to token count deviations
        interval: 1000 * 60 * 1.5, // Refresh tokens after 1.5 minutes to be on the safe side.
      }),
      countTokens: (prompt) =>
        this.countGeminiTokens(prompt, 'gemini-2.5-flash'),
    },
    'googleai/gemini-2.5-flash-lite': {
      // See: https://ai.google.dev/gemini-api/docs/rate-limits#tier-1
      // 1000 per minute requests is Gemini Flash Lite's limit right now.
      requestPerMinute: new RateLimiter({
        tokensPerInterval: 4000,
        interval: 1000 * 60 * 1.5, // Refresh tokens after 1.5 minutes to be on the safe side.
      }),
      tokensPerMinute: new RateLimiter({
        tokensPerInterval: 4_000_000 * 0.75, // *0.75 to be more resilient to token count deviations
        interval: 1000 * 60 * 1.5, // Refresh tokens after 1.5 minutes to be on the safe side.
      }),
      countTokens: (prompt) =>
        this.countGeminiTokens(prompt, 'gemini-2.5-flash-lite'),
    },
  };

  protected pluginFactory(apiKey: string): GenkitPlugin {
    return googleAI({ apiKey });
  }

  getModelSpecificConfig(opts: { includeThoughts?: boolean }): object {
    return { thinkingConfig: { includeThoughts: opts.includeThoughts } };
  }

  validateGeneratedFiles(files: LlmResponseFile[]): boolean {
    // Gemini responses occasionally get truncated on `class=`.
    // Consider these cases as invalid so they don't influence the results.
    return (
      files.length === 0 ||
      !files.some((file) => file.code.trim().endsWith('class='))
    );
  }

  private async countGeminiTokens(
    prompt: PromptDataForCounting,
    modelName: string
  ): Promise<number | null> {
    const contents = [
      ...prompt.messages.map((m) => ({
        role: m.role,
        parts: m.content.map((c) => {
          return 'text' in c
            ? ({ text: c.text } satisfies Part)
            : ({
                inlineData: {
                  data: c.media.base64PngImage,
                  mimeType: 'image/png',
                },
              } satisfies Part);
        }),
      })),
      { role: 'user', parts: [{ text: prompt.prompt }] },
    ];

    try {
      // Note: This is a separate API and doesn't contribute to our model requests/limits!
      return (
        (
          await this.geminiAPI().models.countTokens({
            model: modelName,
            contents,
          })
        ).totalTokens ?? null
      );
    } catch (e: unknown) {
      return null;
    }
  }
}
