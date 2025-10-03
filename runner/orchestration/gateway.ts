import PQueue from 'p-queue';
import {LlmGenerateFilesContext} from '../codegen/llm-runner.js';
import {Environment} from '../configuration/environment.js';
import {ProgressLogger} from '../progress/progress-logger.js';
import {
  LlmContextFile,
  LlmResponse,
  LlmResponseFile,
  RootPromptDefinition,
  TestExecutionResult,
} from '../shared-interfaces.js';
import {BuildResult} from '../workers/builder/builder-types.js';

export type EvalID = string & {__evalID: true};

export interface Gateway<Env extends Environment> {
  /** Initializes an eval. */
  initializeEval(): Promise<EvalID>;

  /** Generates initial files for an eval. */
  generateInitialFiles(
    id: EvalID,
    requestCtx: LlmGenerateFilesContext,
    model: string,
    contextFiles: LlmContextFile[],
    abortSignal: AbortSignal,
  ): Promise<LlmResponse>;

  repairCode(
    id: EvalID,
    requestCtx: LlmGenerateFilesContext,
    model: string,
    errorMessage: string,
    appFiles: LlmResponseFile[],
    contextFiles: LlmContextFile[],
    abortSignal: AbortSignal,
  ): Promise<LlmResponse>;

  shouldRetryFailedBuilds(evalID: EvalID): boolean;

  tryBuild(
    id: EvalID,
    env: Env,
    appDirectoryPath: string,
    rootPromptDef: RootPromptDefinition,
    workerConcurrencyQueue: PQueue,
    abortSignal: AbortSignal,
    progress: ProgressLogger,
  ): Promise<BuildResult>;

  tryTest(
    id: EvalID,
    env: Env,
    appDirectoryPath: string,
    rootPromptDef: RootPromptDefinition,
    workerConcurrencyQueue: PQueue,
    abortSignal: AbortSignal,
    progress: ProgressLogger,
  ): Promise<TestExecutionResult | null>;

  shouldRetryFailedTestExecution(evalID: EvalID): boolean;

  serveBuild<T>(
    id: EvalID,
    env: Env,
    appDirectoryPath: string,
    rootPromptDef: RootPromptDefinition,
    progress: ProgressLogger,
    logicWhileServing: (serveUrl: string) => Promise<T>,
  ): Promise<T>;

  finalizeEval(id: EvalID): Promise<void>;

  // TODO: Consider supporting in the future.
  // rateBuild(id: EvalID): AssessmentResult[];
}
