import { GenerateOptions, ModelReference, z } from 'genkit';
import { GenkitPlugin, GenkitPluginV2 } from 'genkit/plugin';
import { GenkitLocalModelProvider } from '../model-provider.js';
import { ollama } from 'genkitx-ollama';
import {
  LlmGenerateTextRequestOptions,
  LlmConstrainedOutputGenerateRequestOptions,
} from '../../llm-runner.js';
import { generateZodSampleJson } from '../utils/zod-sample-json.js';

const SERVER_ADDRESS =
  'http://127.0.0.1:' + (process.env['OLLAMA_PORT'] || 11434);

const THOUGHTS_CFG_PROMPT =
  '\n\nDo NOT include any thoughts but only the files!';

const outputSchemaPromptGenerator = <T extends z.ZodTypeAny>(schema: T) =>
  '\n\nThe output should match this example JSON schema:\n\n' +
  JSON.stringify(generateZodSampleJson(schema));

export class OllamaModelProvider extends GenkitLocalModelProvider {
  userFacingName: string = 'Ollama';

  protected models: Record<string, () => ModelReference<any>> = {
    'gemma3:4b': () => ollama.model('gemma3:4b'),
    'gemma3:12b': () => ollama.model('gemma3:12b'),
    'codegemma:7b': () => ollama.model('codegemma:7b'),
  };

  async getPlugin(): Promise<GenkitPlugin | GenkitPluginV2 | null> {
    if (!(await this.checkModelsAvailability())) {
      return null;
    }
    return ollama({
      models: [
        { name: 'gemma3:4b' },
        { name: 'gemma3:12b' },
        { name: 'codegemma:7b' },
      ],
      serverAddress: SERVER_ADDRESS,
    });
  }

  override getDefaultGenkitGenerateOptions(
    model: ModelReference<any>,
    options:
      | LlmGenerateTextRequestOptions
      | LlmConstrainedOutputGenerateRequestOptions
  ): GenerateOptions {
    const baseOptions = super.getDefaultGenkitGenerateOptions(model, options);
    const schema = (
      options as Partial<LlmConstrainedOutputGenerateRequestOptions>
    ).schema;

    // Since our local models don't support structured output,
    // we need to include the schema as part of the prompt.
    const prompt =
      options.prompt +
      THOUGHTS_CFG_PROMPT +
      (schema ? outputSchemaPromptGenerator(schema) : '');

    return {
      ...baseOptions,
      prompt,
    };
  }

  /** Checks whether Ollama server is running and if there is at least one supported model available. */
  private async checkModelsAvailability(): Promise<boolean> {
    try {
      const response = await fetch(`${SERVER_ADDRESS}/api/tags`);

      if (response.ok) {
        const tags = (await response.json()) as {
          models: Partial<{ name: string }>[];
        };
        const names = new Set(tags.models.map((m) => m.name));

        for (const supportedModel of Object.keys(this.models)) {
          if (names.has(supportedModel)) {
            return true;
          }
        }
      }
      return false;
    } catch {
      return false;
    }
  }
}
