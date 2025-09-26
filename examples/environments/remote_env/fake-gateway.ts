import {
  BuildResult,
  BuildResultStatus,
  EvalID,
  Gateway,
  LlmContextFile,
  LlmResponse,
  LlmResponseFile,
  RemoteEnvironment,
  RootPromptDefinition,
} from '../../../runner';
import { LlmGenerateFilesContext } from '../../../runner/codegen/llm-runner';
import { ProgressLogger } from '../../../runner/progress/progress-logger';

export class FakeRemoteGateway implements Gateway<RemoteEnvironment> {
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
      outputFiles: [{ code: 'Works!', filePath: 'main.ts' }],
      reasoning: '',
      errors: [],
      usage: { inputTokens: 0, totalTokens: 0, outputTokens: 0 },
    };
  }

  generateInitialFiles(
    id: EvalID,
    requestCtx: LlmGenerateFilesContext,
    model: string,
    contextFiles: LlmContextFile[],
    abortSignal: AbortSignal
  ): Promise<LlmResponse> {
    // Generate the initial files of the eval app.
    // This generation can happen on a remote service with access to private models.
    return this.performFakeLlmRequest();
  }

  repairBuild(
    id: EvalID,
    requestCtx: LlmGenerateFilesContext,
    model: string,
    errorMessage: string,
    appFiles: LlmResponseFile[],
    contextFiles: LlmContextFile[],
    abortSignal: AbortSignal
  ): Promise<LlmResponse> {
    // Repair the given eval app.
    // This generation can happen on a remote service with access to private models.
    return this.performFakeLlmRequest();
  }

  async serveBuild<T>(
    id: EvalID,
    env: RemoteEnvironment,
    appDirectoryPath: string,
    rootPromptDef: RootPromptDefinition,
    progress: ProgressLogger,
    logicWhileServing: (serveUrl: string) => Promise<T>
  ): Promise<T> {
    // Start serving of the app.
    // Invoke the logic while the server is running.
    const result = await logicWhileServing('https://angular.dev');
    // Stop the server.
    return result;
  }

  async tryBuild(
    id: EvalID,
    env: RemoteEnvironment,
    appDirectoryPath: string,
    rootPromptDef: RootPromptDefinition,
    progress: ProgressLogger
  ): Promise<BuildResult> {
    // Here, building can happen in the remote service.
    // Eval ID is useful here for storing the build on a server, for re-using later when serving.
    return {
      message: 'Build successful',
      status: BuildResultStatus.SUCCESS,
    };
  }

  shouldRetryFailedBuilds() {
    // Some environments have a builtin retry loop as part of initial generation.
    // In those cases, you may want to skip retrying.
    return true;
  }

  async finalizeEval() {
    // Do your cleanup.
  }
}
