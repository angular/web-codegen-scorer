import {ChildProcess, fork} from 'node:child_process';
import path, {join} from 'node:path';
import PQueue from 'p-queue';
import {LlmRunner, McpServerDetails} from '../../codegen/llm-runner.js';
import {getRunnerByName, RunnerName} from '../../codegen/runner-creation.js';
import {ProgressLogger} from '../../progress/progress-logger.js';
import {
  LlmContextFile,
  LlmGenerateFilesRequest,
  LlmResponse,
  LlmResponseFile,
  RootPromptDefinition,
  TestExecutionResult,
} from '../../shared-interfaces.js';
import {killChildProcessWithSigterm} from '../../utils/kill-gracefully.js';
import {
  BuildResult,
  BuildWorkerMessage,
  BuildWorkerResponseMessage,
} from '../../workers/builder/builder-types.js';
import {serveApp} from '../../workers/serve-testing/serve-app.js';
import {generateCodeWithAI} from '../codegen.js';
import {EvalID, Executor} from './executor.js';
import {LocalExecutorConfig} from './local-executor-config.js';
import {getPossiblePackageManagers} from '../../configuration/package-managers.js';
import {callWithTimeout} from '../../utils/timeout.js';
import {executeCommand} from '../../utils/exec.js';
import {cleanupBuildMessage} from '../../workers/builder/worker.js';
import {combineAbortSignals} from '../../utils/abort-signal.js';
import {ServeTestingResult} from '../../workers/serve-testing/worker-types.js';

let uniqueIDs = 0;

export class LocalExecutor implements Executor {
  private llm: Promise<LlmRunner>;

  constructor(
    public config: LocalExecutorConfig,
    runnerName: RunnerName = 'noop-unimplemented',
  ) {
    this.llm = getRunnerByName(runnerName);
  }

  async initializeEval(): Promise<EvalID> {
    return `${uniqueIDs++}` as EvalID;
  }

  async generateInitialFiles(
    _id: EvalID,
    requestCtx: LlmGenerateFilesRequest,
    model: string,
    contextFiles: LlmContextFile[],
    abortSignal: AbortSignal,
  ): Promise<LlmResponse> {
    return await generateCodeWithAI(
      await this.llm,
      model,
      {
        ...requestCtx,
        packageManager: this.config.packageManager,
        buildCommand: this.getBuildCommand(),
        possiblePackageManagers: getPossiblePackageManagers().slice(),
      },
      contextFiles,
      abortSignal,
    );
  }

  async generateRepairFiles(
    _id: EvalID,
    requestCtx: LlmGenerateFilesRequest,
    model: string,
    errorMessage: string,
    appFiles: LlmResponseFile[],
    contextFiles: LlmContextFile[],
    abortSignal: AbortSignal,
  ): Promise<LlmResponse> {
    return await generateCodeWithAI(
      await this.llm,
      model,
      {
        ...requestCtx,
        packageManager: this.config.packageManager,
        buildCommand: this.getBuildCommand(),
        possiblePackageManagers: getPossiblePackageManagers().slice(),
      },
      contextFiles,
      abortSignal,
    );
  }

  performBuild(
    _id: EvalID,
    appDirectoryPath: string,
    rootPromptDef: RootPromptDefinition,
    workerConcurrencyQueue: PQueue,
    abortSignal: AbortSignal,
    progress: ProgressLogger,
  ): Promise<BuildResult> {
    const buildParams: BuildWorkerMessage = {
      directory: appDirectoryPath,
      appName: rootPromptDef.name,
      buildCommand: this.getBuildCommand(),
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
            try {
              await killChildProcessWithSigterm(child);
            } catch (e) {
              progress.debugLog(`Error while killing build worker: ${e}`);
            }
            resolve(result.payload);
          });
          child.on('error', async err => {
            try {
              await killChildProcessWithSigterm(child);
            } catch (e) {
              progress.debugLog(`Error while killing build worker: ${e}`);
            }
            reject(err);
          });
        }),
    );
  }

  async executeProjectTests(
    _id: EvalID,
    appDirectoryPath: string,
    rootPromptDef: RootPromptDefinition,
    workerConcurrencyQueue: PQueue,
    abortSignal: AbortSignal,
    progress: ProgressLogger,
  ): Promise<TestExecutionResult | null> {
    if (!this.config.testCommand) {
      return Promise.resolve(null);
    }
    const testCommand = this.config.testCommand;

    let output: string;
    let passed: boolean;

    try {
      // Run the test command inside the temporary project directory
      // Also add to the worker concurrency queue to not overload local systems.
      const stdout = await workerConcurrencyQueue.add(() =>
        callWithTimeout(
          `Testing ${rootPromptDef.name}`,
          timeoutAbort =>
            executeCommand(testCommand, appDirectoryPath, undefined, {
              abortSignal: combineAbortSignals(abortSignal, timeoutAbort),
            }),
          4, // 4min. This is a safety boundary. Lots of parallelism can slow-down.
        ),
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

  async serveWebApplication(
    _id: EvalID,
    appDirectoryPath: string,
    rootPromptDef: RootPromptDefinition,
    progress: ProgressLogger,
    abortSignal: AbortSignal,
    logicWhileServing: (serveUrl: string) => Promise<ServeTestingResult>,
  ): Promise<ServeTestingResult | null> {
    // Serve testing is explicitly disabled.
    if (this.config.serveCommand === null) {
      return null;
    }

    return await serveApp(
      this.getServeCommand(),
      rootPromptDef,
      appDirectoryPath,
      progress,
      abortSignal,
      logicWhileServing,
    );
  }

  async shouldRepairFailedBuilds(): Promise<boolean> {
    return (await this.llm).hasBuiltInRepairLoop === false;
  }

  async finalizeEval(_id: EvalID): Promise<void> {}

  async isSupportedModel(name: string) {
    const availableModels = (await this.llm).getSupportedModels();
    return {
      supported: availableModels.includes(name),
      availableModels,
    };
  }

  async destroy(): Promise<void> {
    await (await this.llm)?.dispose();
  }

  getServeCommand(): string {
    if (this.config.serveCommand != null) {
      return this.config.serveCommand;
    }

    const flags = '--port 0';
    // npm needs -- to pass flags to the command.
    if (this.config.packageManager === 'npm') {
      return `npm run start -- ${flags}`;
    }

    return `${this.config.packageManager} run start ${flags}`;
  }

  getBuildCommand(): string {
    return this.config.buildCommand ?? `${this.config.packageManager} run build`;
  }

  getInstallCommand(): string {
    return `${this.config.packageManager} install --silent`;
  }

  async getExecutorInfo() {
    return {
      id: (await this.llm).id,
      displayName: (await this.llm).displayName,
      mcpServersLaunched: this.config.mcpServers?.length ?? 0,
    };
  }

  async startMcpServerHost(hostName: string): Promise<McpServerDetails | undefined> {
    const llm = await this.llm;
    if (llm.startMcpServerHost === undefined) {
      return undefined;
    }

    return llm.startMcpServerHost(hostName, this.config.mcpServers ?? []);
  }

  async collectMcpServerLogs(mcpServerDetails: McpServerDetails | undefined) {
    const llm = await this.llm;
    if (llm.flushMcpServerLogs === undefined) {
      return;
    }

    return {
      servers: (this.config.mcpServers ?? []).map(m => ({
        name: m.name,
        command: m.command,
        args: m.args,
        tools: mcpServerDetails?.tools ?? [],
        resources: mcpServerDetails?.resources ?? [],
      })),
      logs: llm.flushMcpServerLogs().join('\n'),
    };
  }
}
