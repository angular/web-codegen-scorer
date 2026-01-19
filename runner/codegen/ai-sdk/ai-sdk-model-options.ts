import {AnthropicProviderOptions} from '@ai-sdk/anthropic';
import {GoogleGenerativeAIProviderOptions} from '@ai-sdk/google';
import {OpenAIResponsesProviderOptions} from '@ai-sdk/openai';
import {LanguageModelV3, SharedV3ProviderOptions} from '@ai-sdk/provider';

export type AiSdkModelOptions = {
  model: LanguageModelV3;
  providerOptions:
    | {anthropic: AnthropicProviderOptions}
    | {google: GoogleGenerativeAIProviderOptions}
    | {openai: OpenAIResponsesProviderOptions}
    // This supports extensions of `AISdkRunner` for custom model providers.
    | SharedV3ProviderOptions;
};
