import {
  BuildResult,
  BuildResultStatus,
  EvalID,
  Executor,
  LlmContextFile,
  LlmGenerateFilesRequest,
  LlmResponse,
  LlmResponseFile,
  replaceAtReferencesInPrompt,
  RootPromptDefinition,
} from '../../../runner';
import {ProgressLogger} from '../../../runner/progress/progress-logger';

export class FakeRemoteExecutor implements Executor {
  ids = 0;

  async initializeEval() {
    // Initialize an eval for a prompt.
    // The IDs will be used throughout invocations below and can be used to
    // persist data on a remote service while the eval runs
    // (e.g. for maintaining a build sandbox)
    return `${this.ids++}` as EvalID;
  }

  async performFakeLlmRequest(): Promise<LlmResponse> {
    return {
      success: true,
      outputFiles: [{code: 'angular.dev Works', filePath: 'main.ts'}],
      reasoning: '',
      errors: [],
      usage: {inputTokens: 0, totalTokens: 0, outputTokens: 0, thinkingTokens: 0},
    };
  }

  generateInitialFiles(
    id: EvalID,
    requestCtx: LlmGenerateFilesRequest,
    model: string,
    contextFiles: LlmContextFile[],
    abortSignal: AbortSignal,
  ): Promise<LlmResponse> {
    // Generate the initial files of the eval app.
    // This generation can happen on a remote service with access to private models.
    return this.performFakeLlmRequest();
  }

  generateRepairFiles(
    id: EvalID,
    requestCtx: LlmGenerateFilesRequest,
    model: string,
    errorMessage: string,
    appFiles: LlmResponseFile[],
    contextFiles: LlmContextFile[],
    abortSignal: AbortSignal,
  ): Promise<LlmResponse> {
    // Repair the given eval app.
    // This generation can happen on a remote service with access to private models.
    return this.performFakeLlmRequest();
  }

  async serveWebApplication<T>(
    id: EvalID,
    appDirectoryPath: string,
    rootPromptDef: RootPromptDefinition,
    progress: ProgressLogger,
    abortSignal: AbortSignal,
    logicWhileServing: (serveUrl: string) => Promise<T>,
  ): Promise<T> {
    // Start serving of the app.
    // Invoke the logic while the server is running.
    const result = await logicWhileServing('https://angular.dev');
    // Stop the server.
    return result;
  }

  async performBuild(
    id: EvalID,
    appDirectoryPath: string,
    rootPromptDef: RootPromptDefinition,
  ): Promise<BuildResult> {
    // Here, building can happen in the remote service.
    // Eval ID is useful here for storing the build on a server, for re-using later when serving.
    return {
      message: 'Build successful',
      status: BuildResultStatus.SUCCESS,
    };
  }

  async executeProjectTests() {
    return null;
  }

  async shouldRepairFailedBuilds() {
    // Some environments have a builtin retry loop as part of initial generation.
    // In those cases, you may want to skip retrying.
    return true;
  }

  async finalizeEval() {
    // Do your cleanup.
  }

  async isSupportedModel() {
    return {supported: true};
  }

  async getExecutorInfo() {
    return {
      id: 'fake-executor',
      displayName: 'Fake Executor',
      mcpServersLaunched: 0,
    };
  }

  async postProcessSystemPrompt(prompt: string, environmentRootPath: string) {
    return replaceAtReferencesInPrompt(
      prompt,
      `${environmentRootPath}/prompt.md`,
      environmentRootPath,
    );
  }

  async destroy() {}
}
