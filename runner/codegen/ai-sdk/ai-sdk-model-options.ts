import {AnthropicProviderOptions} from '@ai-sdk/anthropic';
import {GoogleGenerativeAIProviderOptions} from '@ai-sdk/google';
import {OpenAIResponsesProviderOptions} from '@ai-sdk/openai';
import {LanguageModel} from 'ai';

export type ModelOptions = {
  model: LanguageModel;
  providerOptions:
    | {anthropic: AnthropicProviderOptions}
    | {google: GoogleGenerativeAIProviderOptions}
    | {openai: OpenAIResponsesProviderOptions};
};
