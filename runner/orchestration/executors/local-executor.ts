import {ChildProcess, fork} from 'node:child_process';
import path, {join} from 'node:path';
import PQueue from 'p-queue';
import {LlmRunner} from '../../codegen/llm-runner.js';
import {getRunnerByName, RunnerName} from '../../codegen/runner-creation.js';
import {ProgressLogger} from '../../progress/progress-logger.js';
import {
  LlmContextFile,
  LlmGenerateFilesRequest,
  LlmResponse,
  LlmResponseFile,
  RootPromptDefinition,
} from '../../shared-interfaces.js';
import {killChildProcessGracefully} from '../../utils/kill-gracefully.js';
import {
  BuildResult,
  BuildWorkerMessage,
  BuildWorkerResponseMessage,
} from '../../workers/builder/builder-types.js';
import {serveApp} from '../../workers/serve-testing/serve-app.js';
import {generateCodeWithAI} from '../codegen.js';
import {EvalID, Executor} from './executor.js';
import {LocalExecutorConfig} from './local-executor-config.js';
import {getPossiblePackageManagers} from '../../configuration/environment-config.js';

let uniqueIDs = 0;

export class LocalExecutor implements Executor {
  private llm: Promise<LlmRunner>;

  constructor(
    public config: LocalExecutorConfig,
    runnerName: RunnerName = 'genkit',
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
            await killChildProcessGracefully(child);
            resolve(result.payload);
          });
          child.on('error', async err => {
            await killChildProcessGracefully(child);
            reject(err);
          });
        }),
    );
  }

  async serveWebApplication<T>(
    _id: EvalID,
    appDirectoryPath: string,
    rootPromptDef: RootPromptDefinition,
    progress: ProgressLogger,
    logicWhileServing: (serveUrl: string) => Promise<T>,
  ): Promise<T> {
    return await serveApp(
      this.getServeCommand(),
      rootPromptDef,
      appDirectoryPath,
      progress,
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

  async startMcpServerHost(hostName: string) {
    const llm = await this.llm;
    if (llm.startMcpServerHost === undefined) {
      return;
    }

    llm.startMcpServerHost(hostName, this.config.mcpServers ?? []);
  }

  async collectMcpServerLogs() {
    const llm = await this.llm;
    if (llm.flushMcpServerLogs === undefined) {
      return;
    }

    return {
      servers: (this.config.mcpServers ?? []).map(m => ({
        name: m.name,
        command: m.command,
        args: m.args,
      })),
      logs: llm.flushMcpServerLogs().join('\n'),
    };
  }
}
