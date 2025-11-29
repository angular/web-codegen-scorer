import {anthropic, AnthropicProviderOptions} from '@ai-sdk/anthropic';
import {wrapLanguageModel} from 'ai';
import {anthropicThinkingWithStructuredResponseMiddleware} from './anthropic_thinking_patch.js';
import {ModelOptions} from './ai-sdk-model-options.js';

export const ANTHROPIC_MODELS = [
  'claude-opus-4.1-no-thinking',
  'claude-opus-4.1-with-thinking-16k',
  'claude-opus-4.1-with-thinking-32k',
  'claude-opus-4.5-no-thinking',
  'claude-opus-4.5-with-thinking-16k',
  'claude-opus-4.5-with-thinking-32k',
  'claude-sonnet-4.5-no-thinking',
  'claude-sonnet-4.5-with-thinking-16k',
  'claude-sonnet-4.5-with-thinking-32k',
] as const;

export async function getAiSdkModelOptionsForAnthropic(
  rawModelName: string,
): Promise<ModelOptions | null> {
  const modelName = rawModelName as (typeof ANTHROPIC_MODELS)[number];

  switch (modelName) {
    case 'claude-opus-4.1-no-thinking':
    case 'claude-opus-4.1-with-thinking-16k':
    case 'claude-opus-4.1-with-thinking-32k':
    case 'claude-opus-4.5-no-thinking':
    case 'claude-opus-4.5-with-thinking-16k':
    case 'claude-opus-4.5-with-thinking-32k':
    case 'claude-sonnet-4.5-no-thinking':
    case 'claude-sonnet-4.5-with-thinking-16k':
    case 'claude-sonnet-4.5-with-thinking-32k': {
      const thinkingEnabled = modelName.includes('-with-thinking');
      const thinkingBudget = !thinkingEnabled
        ? undefined
        : modelName.endsWith('-32k')
          ? 32_000
          : 16_000;
      let apiModelName: Parameters<typeof anthropic>[0] = 'claude-sonnet-4-5';
      if (modelName.includes('opus-4.1')) {
        apiModelName = 'claude-opus-4-1';
      } else if (modelName.includes('opus-4.5')) {
        apiModelName = 'claude-opus-4.5';
      }
      const model = anthropic(apiModelName);
      return {
        model: thinkingEnabled
          ? wrapLanguageModel({
              model,
              middleware: anthropicThinkingWithStructuredResponseMiddleware,
            })
          : model,
        providerOptions: {
          anthropic: {
            sendReasoning: thinkingEnabled,
            thinking: {
              type: thinkingEnabled ? 'enabled' : 'disabled',
              budgetTokens: thinkingBudget,
            },
          } satisfies AnthropicProviderOptions,
        },
      };
    }
    default:
      return null;
  }
}
