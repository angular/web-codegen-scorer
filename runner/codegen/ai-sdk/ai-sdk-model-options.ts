import {AnthropicProviderOptions} from '@ai-sdk/anthropic';
import {GoogleGenerativeAIProviderOptions} from '@ai-sdk/google';
import {OpenAIResponsesProviderOptions} from '@ai-sdk/openai';
import {LanguageModelV3} from '@ai-sdk/provider';

export type ModelOptions = {
  model: LanguageModelV3;
  providerOptions:
    | {anthropic: AnthropicProviderOptions}
    | {google: GoogleGenerativeAIProviderOptions}
    | {openai: OpenAIResponsesProviderOptions};
};
