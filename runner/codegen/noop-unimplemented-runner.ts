import {
  LlmRunner,
  LocalLlmConstrainedOutputGenerateResponse,
  LocalLlmGenerateFilesResponse,
  LocalLlmGenerateTextResponse,
} from './llm-runner.js';

/**
 * Noop runner that is useful for creating a `LocalExecutor`
 * that doesn't leverage a runner specified to WCS.
 *
 * E.g. a custom executor that uses pre-scraped LLM output will override
 * corresponding generation methods in the `Executor` but doesn't want
 * the Genkit LLM runner to be instantiated just to expect a `GEMINI_API_KEY`.
 */
export class NoopUnimplementedRunner implements LlmRunner {
  displayName = 'noop-unimplemented';
  id = 'noop-unimplemented';
  hasBuiltInRepairLoop = true;

  generateFiles(): Promise<LocalLlmGenerateFilesResponse> {
    throw new Error('Method not implemented.');
  }
  generateText(): Promise<LocalLlmGenerateTextResponse> {
    throw new Error('Method not implemented.');
  }
  generateConstrained(): Promise<LocalLlmConstrainedOutputGenerateResponse<any>> {
    throw new Error('Method not implemented.');
  }
  getSupportedModels(): string[] {
    throw new Error('Method not implemented.');
  }
  async dispose(): Promise<void> {
    throw new Error('Method not implemented.');
  }
}
