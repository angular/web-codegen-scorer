import {createXai, XaiProviderOptions} from '@ai-sdk/xai';
import {AiSdkModelOptions} from './ai-sdk-model-options.js';

export const XAI_MODELS = ['grok-4', 'grok-code-fast-1'] as const;

export async function getAiSdkModelOptionsForXai(
  rawModelName: string,
): Promise<AiSdkModelOptions | null> {
  const provideModel = createXai({apiKey: process.env['XAI_API_KEY']});
  const modelName = rawModelName as (typeof XAI_MODELS)[number];

  switch (modelName) {
    case 'grok-4':
    case 'grok-code-fast-1':
      const reasoningEffort = modelName === 'grok-4' ? 'high' : 'low';

      return {
        model: provideModel(modelName),
        providerOptions: {
          xai: {
            reasoningEffort,
          } satisfies XaiProviderOptions,
        },
      };
    default:
      return null;
  }
}
