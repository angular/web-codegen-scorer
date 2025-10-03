import {ChildProcess, fork} from 'node:child_process';
import {
  BuildResult,
  BuildWorkerMessage,
  BuildWorkerResponseMessage,
} from '../../workers/builder/builder-types.js';
import {LlmGenerateFilesContext, LlmRunner} from '../../codegen/llm-runner.js';
import {
  RootPromptDefinition,
  LlmContextFile,
  LlmResponse,
  LlmResponseFile,
  TestExecutionResult,
} from '../../shared-interfaces.js';
import {generateCodeWithAI} from '../codegen.js';
import {EvalID, Gateway} from '../gateway.js';
import path from 'node:path';
import {killChildProcessGracefully} from '../../utils/kill-gracefully.js';
import {ProgressLogger} from '../../progress/progress-logger.js';
import {serveApp} from '../../workers/serve-testing/serve-app.js';
import {LocalEnvironment} from '../../configuration/environment-local.js';
import PQueue from 'p-queue';
import {executeCommand} from '../../utils/exec.js';
import {callWithTimeout} from '../../utils/timeout.js';
import {cleanupBuildMessage} from '../../workers/builder/worker.js';

let uniqueIDs = 0;

export class LocalGateway implements Gateway<LocalEnvironment> {
  constructor(private llm: LlmRunner) {}

  async initializeEval(): Promise<EvalID> {
    return `${uniqueIDs++}` as EvalID;
  }

  async generateInitialFiles(
    _id: EvalID,
    requestCtx: LlmGenerateFilesContext,
    model: string,
    contextFiles: LlmContextFile[],
    abortSignal: AbortSignal,
  ): Promise<LlmResponse> {
    return await generateCodeWithAI(this.llm, model, requestCtx, contextFiles, abortSignal);
  }

  async repairCode(
    _id: EvalID,
    requestCtx: LlmGenerateFilesContext,
    model: string,
    errorMessage: string,
    appFiles: LlmResponseFile[],
    contextFiles: LlmContextFile[],
    abortSignal: AbortSignal,
  ): Promise<LlmResponse> {
    return await generateCodeWithAI(this.llm, model, requestCtx, contextFiles, abortSignal);
  }

  tryBuild(
    _id: EvalID,
    env: LocalEnvironment,
    appDirectoryPath: string,
    rootPromptDef: RootPromptDefinition,
    workerConcurrencyQueue: PQueue,
    abortSignal: AbortSignal,
    progress: ProgressLogger,
  ): Promise<BuildResult> {
    const buildParams: BuildWorkerMessage = {
      directory: appDirectoryPath,
      appName: rootPromptDef.name,
      buildCommand: env.buildCommand,
    };

    return workerConcurrencyQueue.add(
      () =>
        new Promise<BuildResult>((resolve, reject) => {
          const child: ChildProcess = fork(
            path.resolve(import.meta.dirname, '../../workers/builder/worker.js'),
            {signal: abortSignal},
          );
          child.send(buildParams);

          child.on('message', async (result: BuildWorkerResponseMessage) => {
            await killChildProcessGracefully(child);
            resolve(result.payload);
          });
          child.on('error', async err => {
            await killChildProcessGracefully(child);
            reject(err);
          });
        }),
      {throwOnTimeout: true},
    );
  }

  async tryTest(
    _id: EvalID,
    env: LocalEnvironment,
    appDirectoryPath: string,
    rootPromptDef: RootPromptDefinition,
    workerConcurrencyQueue: PQueue,
    abortSignal: AbortSignal,
    progress: ProgressLogger,
  ): Promise<TestExecutionResult | null> {
    if (!env.testCommand) {
      return Promise.resolve(null);
    }

    let output: string;
    let passed: boolean;

    try {
      // Run the test command inside the temporary project directory
      const stdout = await callWithTimeout(
        `Testing ${rootPromptDef.name}`,
        timeoutAbort =>
          executeCommand(env.testCommand!, appDirectoryPath, undefined, {
            abortSignal: AbortSignal.any([abortSignal, timeoutAbort]),
          }),
        4, // 4min. This is a safety boundary. Lots of parallelism can slow-down.
      );
      output = stdout;
      passed = true;
    } catch (error: any) {
      output = error.message;
      passed = false;
    }

    return {
      passed,
      output: cleanupBuildMessage(output),
    } satisfies TestExecutionResult;
  }

  async serveBuild<T>(
    _id: EvalID,
    env: LocalEnvironment,
    appDirectoryPath: string,
    rootPromptDef: RootPromptDefinition,
    progress: ProgressLogger,
    logicWhileServing: (serveUrl: string) => Promise<T>,
  ): Promise<T> {
    return await serveApp(
      env.serveCommand,
      rootPromptDef,
      appDirectoryPath,
      progress,
      logicWhileServing,
    );
  }

  shouldRetryFailedBuilds(): boolean {
    return this.llm.hasBuiltInRepairLoop === false;
  }

  shouldRetryFailedTestExecution(): boolean {
    return this.llm.hasBuiltInRepairLoop === false;
  }

  async finalizeEval(_id: EvalID): Promise<void> {}
}
