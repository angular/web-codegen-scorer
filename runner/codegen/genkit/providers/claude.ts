import {Anthropic} from '@anthropic-ai/sdk';
import {GenkitPlugin} from 'genkit/plugin';
import {GenkitModelProvider, PromptDataForCounting, RateLimitConfig} from '../model-provider.js';
import {anthropic} from 'genkitx-anthropic';
import {claude35Haiku, claude4Sonnet} from 'genkitx-anthropic';
import {lazy} from '../../../utils/lazy-creation.js';
import {RateLimiter} from 'limiter';

export class ClaudeModelProvider extends GenkitModelProvider {
  readonly apiKeyVariableName = 'ANTHROPIC_API_KEY';

  protected readonly models = {
    'claude-4.0-sonnet': () => claude4Sonnet,
    'claude-3.5-haiku': () => claude35Haiku,
  };

  protected rateLimitConfig: Record<string, RateLimitConfig> = {
    // See: https://docs.anthropic.com/en/api/rate-limits#tier-2
    'anthropic/claude-4-sonnet': {
      requestPerMinute: new RateLimiter({
        tokensPerInterval: 1000,
        interval: 1000 * 60 * 1.5, // Refresh tokens after 1.5 minutes to be on the safe side.
      }),
      tokensPerMinute: new RateLimiter({
        tokensPerInterval: 40_000 * 0.75, // *0.75 to be more resilient to token count deviations
        interval: 1000 * 60 * 1.5, // Refresh tokens after 1.5 minutes to be on the safe side.
      }),
      countTokens: prompt => this.countClaudeTokens(prompt),
    },
  };

  getModelSpecificConfig(): object {
    // TODO: Add thinking output for Claude.
    return {};
  }

  validateGeneratedFiles(): boolean {
    return true;
  }

  private anthropicApi = lazy(() => {
    return new Anthropic({apiKey: this.getApiKey() || undefined});
  });

  protected pluginFactory(apiKey: string): GenkitPlugin {
    return anthropic({apiKey});
  }

  private async countClaudeTokens(prompt: PromptDataForCounting): Promise<number | null> {
    const sonnetPrompt: string | Anthropic.Messages.MessageParam[] = [];
    for (const part of prompt.messages) {
      for (const c of part.content) {
        sonnetPrompt.push({
          role: part.role === 'user' ? 'user' : 'assistant',
          content:
            'media' in c
              ? [
                  {
                    source: {
                      media_type: 'image/png',
                      data: c.media.base64PngImage,
                      type: 'base64',
                    },
                    type: 'image',
                  },
                ]
              : c.text,
        });
      }
    }
    const messages: Anthropic.Messages.MessageParam[] = [
      ...sonnetPrompt,
      {content: prompt.prompt, role: 'user'},
    ];

    return (
      await this.anthropicApi().messages.countTokens({
        model: 'claude-sonnet-4-0',
        messages,
      })
    ).input_tokens;
  }
}
