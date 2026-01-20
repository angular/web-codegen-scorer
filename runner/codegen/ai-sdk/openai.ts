import {createOpenAI, OpenAIResponsesProviderOptions} from '@ai-sdk/openai';
import {AiSdkModelOptions} from './ai-sdk-model-options.js';

export const OPENAI_MODELS = [
  'gpt-5.1-no-thinking',
  'gpt-5.1-thinking-low',
  'gpt-5.1-thinking-high',
  'gpt-5.1-thinking-medium',
] as const;

export async function getAiSdkModelOptionsForOpenAI(
  rawModelName: string,
): Promise<AiSdkModelOptions | null> {
  const provideModel = createOpenAI({apiKey: process.env['OPENAI_API_KEY']});
  const modelName = rawModelName as (typeof OPENAI_MODELS)[number];

  switch (modelName) {
    case 'gpt-5.1-no-thinking':
    case 'gpt-5.1-thinking-low':
    case 'gpt-5.1-thinking-medium':
    case 'gpt-5.1-thinking-high':
      let reasoningEffort: string = 'none';
      if (modelName === 'gpt-5.1-thinking-high') {
        reasoningEffort = 'high';
      } else if (modelName === 'gpt-5.1-thinking-medium') {
        reasoningEffort = 'medium';
      } else if (modelName === 'gpt-5.1-thinking-low') {
        reasoningEffort = 'low';
      }
      return {
        model: provideModel('gpt-5.1'),
        providerOptions: {
          openai: {
            reasoningEffort,
            reasoningSummary: 'detailed',
          } satisfies OpenAIResponsesProviderOptions,
        },
      };
    default:
      return null;
  }
}
