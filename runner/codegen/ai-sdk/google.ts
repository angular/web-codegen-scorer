import {createGoogleGenerativeAI, GoogleGenerativeAIProviderOptions} from '@ai-sdk/google';
import {AiSdkModelOptions} from './ai-sdk-model-options.js';

export const GOOGLE_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-no-thinking',
  'gemini-2.5-flash-with-thinking-16k',
  'gemini-2.5-flash-with-thinking-24k',
  'gemini-2.5-pro',
  'gemini-3-pro-preview',
] as const;

export async function getAiSdkModelOptionsForGoogle(
  rawModelName: string,
): Promise<AiSdkModelOptions | null> {
  const modelName = rawModelName as (typeof GOOGLE_MODELS)[number];
  const provideModel = createGoogleGenerativeAI({apiKey: process.env['GEMINI_API_KEY']});

  switch (modelName) {
    case 'gemini-2.5-flash-lite':
    case 'gemini-2.5-flash':
    case 'gemini-2.5-pro':
    case 'gemini-3-pro-preview':
      return {
        model: provideModel(modelName),
        providerOptions: {
          google: {
            thinkingConfig: {
              includeThoughts: true,
            },
          } satisfies GoogleGenerativeAIProviderOptions,
        },
      };
    case 'gemini-2.5-flash-no-thinking': {
      return {
        model: provideModel('gemini-2.5-flash'),
        providerOptions: {
          google: {
            thinkingConfig: {
              thinkingBudget: 0,
            },
          },
        },
      };
    }
    case 'gemini-2.5-flash-with-thinking-16k':
    case 'gemini-2.5-flash-with-thinking-24k':
      let thinkingBudget: number;
      if (modelName.endsWith('-16k')) {
        thinkingBudget = 16_000;
      } else if (modelName.endsWith('-24k')) {
        thinkingBudget = 24_000;
      } else {
        throw new Error(`Unexpected model: ${modelName}`);
      }

      return {
        model: provideModel('gemini-2.5-flash'),
        providerOptions: {
          google: {
            thinkingConfig: {
              thinkingBudget: thinkingBudget,
              includeThoughts: true,
            },
          } satisfies GoogleGenerativeAIProviderOptions,
        },
      };
    default:
      return null;
  }
}
