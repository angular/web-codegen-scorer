import { GenerateOptions, ModelReference } from 'genkit';
import { GenkitPlugin, GenkitPluginV2 } from 'genkit/plugin';
import { RateLimiter } from 'limiter';
import {
  LlmConstrainedOutputGenerateRequestOptions,
  LlmGenerateTextRequestOptions,
  PromptDataMessage,
} from '../llm-runner.js';

export interface RateLimitConfig {
  requestPerMinute: RateLimiter;
  tokensPerMinute: RateLimiter;
  countTokens(prompt: PromptDataForCounting): Promise<number | null>;
}

export interface PromptDataForCounting {
  prompt: string;
  messages: PromptDataMessage[];
}

/** Abstraction around a generic LLM provider. */
export abstract class GenkitModelProvider {
  abstract readonly userFacingName: string;
  protected abstract readonly models: Record<string, () => ModelReference<any>>;

  /** Creates a model instance, if the the provider supports the model. */
  createModel(name: string): ModelReference<any> | null {
    return this.supportsModel(name) ? this.models[name]() : null;
  }

  /** Returns whether the provider supports a specific model. */
  supportsModel(name: string): boolean {
    return this.models.hasOwnProperty(name);
  }

  /** Gets the names of all models supported by the provider. */
  getSupportedModels(): string[] {
    return Object.keys(this.models);
  }

  /** Returns the default Genkit generate options. */
  getDefaultGenkitGenerateOptions(
    model: ModelReference<any>,
    options:
      | LlmGenerateTextRequestOptions
      | LlmConstrainedOutputGenerateRequestOptions
  ): GenerateOptions {
    const schema = (
      options as Partial<LlmConstrainedOutputGenerateRequestOptions>
    ).schema;

    return {
      prompt: options.prompt,
      model,
      output: schema
        ? {
            // Note that the schema needs to be cast to `any`, because allowing its type to
            // be inferred ends up causing `TS2589: Type instantiation is excessively deep
            // and possibly infinite.`, most likely due to how the Genkit type inferrence
            // is set up. This doesn't affect the return type since it was already `ZodTypeAny`
            // which coerces to `any`.
            schema: schema as any,
            constrained: true,
          }
        : undefined,
      messages: options.messages,
      abortSignal: options.abortSignal,
    };
  }

  /** Gets a Genkit plugin that can be used to query the provider. */
  abstract getPlugin(): Promise<GenkitPlugin | GenkitPluginV2 | null>;
}

/** Abstraction around a cloud-based LLM provider. */
export abstract class GenkitCloudModelProvider extends GenkitModelProvider {
  abstract readonly apiKeyVariableName: string;
  protected abstract readonly rateLimitConfig: Record<string, RateLimitConfig>;

  /** Gets the API key associated with this provider. */
  getApiKey(): string | null {
    return process.env[this.apiKeyVariableName] || null;
  }

  /** Gets a Genkit plugin that can be used to query the provider. */
  async getPlugin(): Promise<GenkitPlugin | GenkitPluginV2 | null> {
    const key = this.getApiKey();
    return key ? this.pluginFactory(key) : null;
  }

  protected abstract pluginFactory(
    apiKey: string
  ): GenkitPlugin | GenkitPluginV2;

  async rateLimit(
    prompt: PromptDataForCounting,
    model: ModelReference<any>
  ): Promise<void> {
    const config = this.rateLimitConfig[model.name];

    if (config) {
      await config.requestPerMinute.removeTokens(1);
      const tokenCount = (await config.countTokens(prompt)) ?? 0;
      await config.tokensPerMinute.removeTokens(tokenCount);
    }
  }
}

/** Abstraction around a local LLM provider. */
export abstract class GenkitLocalModelProvider extends GenkitModelProvider {}
