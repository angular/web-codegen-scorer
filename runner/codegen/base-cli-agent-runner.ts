import {ChildProcess, spawn} from 'child_process';
import {join, relative} from 'path';
import {existsSync} from 'fs';
import assert from 'assert';
import chalk from 'chalk';
import {
  LocalLlmConstrainedOutputGenerateResponse,
  LocalLlmGenerateFilesRequestOptions,
  LocalLlmGenerateFilesResponse,
  LocalLlmGenerateTextResponse,
} from './llm-runner.js';
import {DirectorySnapshot} from './directory-snapshot.js';
import {LlmResponseFile} from '../shared-interfaces.js';
import {UserFacingError} from '../utils/errors.js';

/** Helper to check if debug mode is enabled. */
function isDebugEnabled(): boolean {
  return !!process.env['CLI_RUNNER_DEBUG'];
}

/** Helper to log debug messages to stderr. */
function debugLog(category: string, message: string, data?: unknown): void {
  if (!isDebugEnabled()) {
    return;
  }
  const timestamp = new Date().toISOString();
  console.error(chalk.cyan(`[DEBUG ${chalk.dim(timestamp)}] [${category}] ${message}`));
  if (data !== undefined) {
    console.error(
      chalk.cyan(`[DEBUG ${chalk.dim(timestamp)}] [${category}] Data:`),
      JSON.stringify(data, null, 2),
    );
  }
}

/** Base class for a command-line-based runner. */
export abstract class BaseCliAgentRunner {
  abstract readonly displayName: string;
  protected abstract readonly binaryName: string;
  protected abstract readonly ignoredFilePatterns: string[];
  protected abstract getCommandLineFlags(options: LocalLlmGenerateFilesRequestOptions): string[];
  protected abstract writeAgentFiles(options: LocalLlmGenerateFilesRequestOptions): Promise<void>;
  protected inactivityTimeoutMins = 2;
  protected totalRequestTimeoutMins = 10;

  private pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();
  private pendingProcesses = new Set<ChildProcess>();
  private binaryPath: string | null = null;
  private commonIgnoredPatterns = ['**/node_modules/**', '**/dist/**', '**/.angular/**'];

  async generateFiles(
    options: LocalLlmGenerateFilesRequestOptions,
  ): Promise<LocalLlmGenerateFilesResponse> {
    const {context} = options;

    debugLog('generateFiles', `Starting generateFiles for ${this.displayName}`, {
      directory: context.directory,
      buildCommand: context.buildCommand,
      packageManager: context.packageManager,
      model: options.model,
      executablePromptLength: context.executablePrompt?.length ?? 0,
      executablePromptPreview: context.executablePrompt?.substring(0, 500) ?? '<no prompt>',
      combinedPromptLength: context.combinedPrompt?.length ?? 0,
      systemInstructionsLength: context.systemInstructions?.length ?? 0,
    });

    // TODO: Consider removing these assertions when we have better types.
    assert(
      context.buildCommand,
      'Expected a `buildCommand` to be set in the LLM generate request context',
    );
    assert(
      context.packageManager,
      'Expected a `packageManager` to be set in the LLM generate request context',
    );

    const ignoredPatterns = [...this.commonIgnoredPatterns, ...this.ignoredFilePatterns];
    debugLog('generateFiles', 'Ignored patterns', ignoredPatterns);

    const initialSnapshot = await DirectorySnapshot.forDirectory(
      context.directory,
      ignoredPatterns,
    );
    debugLog('generateFiles', 'context.directory', context.directory);

    debugLog('generateFiles', `Initial snapshot captured`, {
      fileCount: initialSnapshot.files.size,
      files: Array.from(initialSnapshot.files.keys()),
    });

    debugLog('generateFiles', 'Writing agent files...');
    await this.writeAgentFiles(options);
    debugLog('generateFiles', 'Agent files written successfully');

    debugLog('generateFiles', 'Starting agent process...');
    const reasoning = await this.runAgentProcess(options);
    debugLog('generateFiles', `Agent process completed`, {
      reasoningLength: reasoning.length,
      reasoning,
    });

    const finalSnapshot = await DirectorySnapshot.forDirectory(context.directory, ignoredPatterns);
    debugLog('generateFiles', `Final snapshot captured`, {
      fileCount: finalSnapshot.files.size,
      files: Array.from(finalSnapshot.files.keys()),
    });

    const diff = finalSnapshot.getChangedOrAddedFiles(initialSnapshot);
    debugLog('generateFiles', `Diff computed`, {
      changedOrAddedFileCount: diff.size,
      changedOrAddedFiles: Array.from(diff.keys()),
    });

    const files: LlmResponseFile[] = [];

    for (const [absolutePath, code] of diff) {
      files.push({
        filePath: relative(context.directory, absolutePath),
        code,
      });
    }

    debugLog('generateFiles', `Returning result`, {
      fileCount: files.length,
      filePaths: files.map(f => f.filePath),
    });

    return {files, reasoning, toolLogs: []};
  }

  generateText(): Promise<LocalLlmGenerateTextResponse> {
    // Technically we can make this work, but we don't need it at the time of writing.
    throw new UserFacingError(`Generating text with ${this.displayName} is not supported.`);
  }

  generateConstrained(): Promise<LocalLlmConstrainedOutputGenerateResponse<any>> {
    // We can't support this, because there's no straightforward
    // way to tell the agent to follow a schema.
    throw new UserFacingError(`Constrained output with ${this.displayName} is not supported.`);
  }

  async dispose(): Promise<void> {
    for (const timeout of this.pendingTimeouts) {
      clearTimeout(timeout);
    }

    for (const childProcess of this.pendingProcesses) {
      childProcess.kill('SIGKILL');
    }

    this.pendingTimeouts.clear();
    this.pendingProcesses.clear();
  }

  /** Gets patterns of files that likely all agents need to ignore. */
  protected getCommonIgnorePatterns() {
    return {
      directories: [
        '/dist',
        '/tmp',
        '/out-tsc',
        '/bazel-out',
        '/node_modules',
        '/.angular/cache',
        '.sass-cache/',
        '.DS_Store',
      ],
      files: [
        'npm-debug.log',
        'yarn-error.log',
        '.editorconfig',
        '.postcssrc.json',
        '.gitignore',
        'yarn.lock',
        'pnpm-lock.yaml',
        'package-lock.json',
        'pnpm-workspace.yaml',
        'Thumbs.db',
      ],
    };
  }

  /** Gets the common system instructions for all agents. */
  protected getCommonInstructions(options: LocalLlmGenerateFilesRequestOptions) {
    return [
      `# Important Rules`,
      `The following instructions dictate how you should behave. It is CRITICAL that you follow them AS CLOSELY AS POSSIBLE:`,
      `- Do NOT attempt to improve the existing code, only implement the user request.`,
      `- STOP once you've implemented the user request, do NOT try to clean up the project.`,
      `- You ARE NOT ALLOWED to install dependencies. Assume that all necessary dependencies are already installed.`,
      `- Do NOT clean up unused files.`,
      `- Do NOT run the dev server, use \`${options.context.buildCommand}\` to verify the build correctness instead.`,
      `- Do NOT use \`git\` or any other versioning software.`,
      `- Do NOT attempt to lint the project.`,
      '',
      `Following the rules is VERY important and should be done with the utmost care!`,
      '',
      '',
      options.context.systemInstructions,
    ].join('\n');
  }

  private resolveBinaryPath(binaryName: string): string {
    debugLog('resolveBinaryPath', 'Starting binary resolution', {binaryName});

    let dir = import.meta.dirname;
    let closestRoot: string | null = null;

    debugLog('resolveBinaryPath', 'Starting directory traversal', {startDir: dir});

    // Attempt to resolve the agent CLI binary by starting at the current file and going up until
    // we find the closest `node_modules`. Note that we can't rely on `import.meta.resolve` here,
    // because that'll point us to the agent bundle, but not its binary. In some package
    // managers (pnpm specifically) the `node_modules` in which the file is installed is different
    // from the one in which the binary is placed.
    while (dir.length > 1) {
      const nodeModulesPath = join(dir, 'node_modules');
      const hasNodeModules = existsSync(nodeModulesPath);

      debugLog('resolveBinaryPath', `Checking directory`, {
        dir,
        nodeModulesPath,
        hasNodeModules,
      });

      if (hasNodeModules) {
        closestRoot = dir;
        debugLog('resolveBinaryPath', 'Found node_modules', {closestRoot});
        break;
      }

      const parent = join(dir, '..');

      if (parent === dir) {
        // We've reached the root, stop traversing.
        debugLog('resolveBinaryPath', 'Reached filesystem root without finding node_modules');
        break;
      } else {
        dir = parent;
      }
    }

    const binaryPath = closestRoot ? join(closestRoot, `node_modules/.bin/${binaryName}`) : null;
    const binaryExists = binaryPath ? existsSync(binaryPath) : false;

    debugLog('resolveBinaryPath', 'Binary path resolution result', {
      closestRoot,
      binaryPath,
      binaryExists,
    });

    if (!binaryPath || !binaryExists) {
      debugLog('resolveBinaryPath', 'Binary not found, throwing error');
      throw new UserFacingError(`${this.displayName} is not installed inside the current project`);
    }

    debugLog('resolveBinaryPath', 'Binary resolved successfully', {binaryPath});
    return binaryPath;
  }

  private runAgentProcess(options: LocalLlmGenerateFilesRequestOptions): Promise<string> {
    return new Promise<string>(resolve => {
      let stdoutBuffer = '';
      let stdErrBuffer = '';
      let isDone = false;
      let stdoutChunkCount = 0;
      let stderrChunkCount = 0;
      const inactivityTimeoutMins = this.inactivityTimeoutMins;
      const totalRequestTimeoutMins = this.totalRequestTimeoutMins;
      const msPerMin = 1000 * 60;

      debugLog('runAgentProcess', 'Initializing agent process', {
        inactivityTimeoutMins,
        totalRequestTimeoutMins,
      });

      const finalize = (finalMessage: string) => {
        if (isDone) {
          debugLog('runAgentProcess', 'finalize called but already done, skipping');
          return;
        }

        isDone = true;

        debugLog('runAgentProcess', 'Finalizing process', {
          finalMessage,
          stdoutBufferLength: stdoutBuffer.length,
          stdErrBufferLength: stdErrBuffer.length,
          stdoutChunkCount,
          stderrChunkCount,
        });

        if (inactivityTimeout) {
          clearTimeout(inactivityTimeout);
          this.pendingTimeouts.delete(inactivityTimeout);
        }

        clearTimeout(globalTimeout);
        childProcess.kill('SIGKILL');
        this.pendingTimeouts.delete(globalTimeout);
        this.pendingProcesses.delete(childProcess);

        const separator = '\n--------------------------------------------------\n';

        if (stdErrBuffer.length > 0) {
          stdoutBuffer += separator + 'Stderr output:\n' + stdErrBuffer;
        }

        stdoutBuffer += separator + finalMessage;

        debugLog('runAgentProcess', 'Process finalized, resolving promise', {
          totalOutputLength: stdoutBuffer.length,
        });

        resolve(stdoutBuffer);
      };

      const noOutputCallback = () => {
        debugLog('runAgentProcess', 'Inactivity timeout triggered', {
          inactivityTimeoutMins,
          stdoutBufferLength: stdoutBuffer.length,
          stdErrBufferLength: stdErrBuffer.length,
        });
        finalize(
          `There was no output from ${this.displayName} for ${inactivityTimeoutMins} minute(s). ` +
            `Stopping the process...`,
        );
      };

      // The agent can get into a state where it stops outputting code, but it also doesn't exit
      // the process. Stop if there hasn't been any output for a certain amount of time.
      let inactivityTimeout = setTimeout(noOutputCallback, inactivityTimeoutMins * msPerMin);
      this.pendingTimeouts.add(inactivityTimeout);

      // Also add a timeout for the entire codegen process.
      const globalTimeout = setTimeout(() => {
        debugLog('runAgentProcess', 'Global timeout triggered', {
          totalRequestTimeoutMins,
          stdoutBufferLength: stdoutBuffer.length,
          stdErrBufferLength: stdErrBuffer.length,
        });
        finalize(
          `${this.displayName} didn't finish within ${totalRequestTimeoutMins} minute(s). ` +
            `Stopping the process...`,
        );
      }, totalRequestTimeoutMins * msPerMin);

      this.binaryPath ??= this.resolveBinaryPath(this.binaryName);

      const commandFlags = this.getCommandLineFlags(options);
      const commandLine = `${this.binaryPath} ${commandFlags.join(' ')}`;

      debugLog('runAgentProcess', 'Resolved binary and command', {
        binaryPath: this.binaryPath,
        commandFlags,
        commandLine,
        cwd: options.context.directory,
      });

      const childProcess = spawn(this.binaryPath, commandFlags, {
        cwd: options.context.directory,
        env: {...process.env},
      });

      debugLog('runAgentProcess', 'Child process spawned', {
        pid: childProcess.pid,
        connected: childProcess.connected,
        killed: childProcess.killed,
      });

      this.pendingProcesses.add(childProcess);

      // Important! some agents won't start executing until stdin has ended.
      childProcess.stdin.end();
      debugLog('runAgentProcess', 'stdin closed');

      childProcess.on('error', error => {
        debugLog('runAgentProcess', 'Process error event', {
          errorMessage: error.message,
          errorName: error.name,
          errorStack: error.stack,
        });
      });

      childProcess.on('close', code => {
        debugLog('runAgentProcess', 'Process close event', {
          exitCode: code,
          stdoutBufferLength: stdoutBuffer.length,
          stdErrBufferLength: stdErrBuffer.length,
          stdoutChunkCount,
          stderrChunkCount,
        });
        finalize(
          `${this.displayName} process has exited` + (code == null ? '.' : ` with ${code} code.`),
        );
      });

      childProcess.on('exit', (code, signal) => {
        debugLog('runAgentProcess', 'Process exit event', {
          exitCode: code,
          signal,
        });
      });

      childProcess.stdout.on('data', data => {
        stdoutChunkCount++;
        const chunk = data.toString();

        debugLog('runAgentProcess', `stdout data received (chunk #${stdoutChunkCount})`, {
          chunkLength: chunk.length,
          chunkPreview: chunk,
          totalStdoutLength: stdoutBuffer.length + chunk.length,
        });

        if (inactivityTimeout) {
          this.pendingTimeouts.delete(inactivityTimeout);
          clearTimeout(inactivityTimeout);
        }

        stdoutBuffer += chunk;
        inactivityTimeout = setTimeout(noOutputCallback, inactivityTimeoutMins * msPerMin);
        this.pendingTimeouts.add(inactivityTimeout);
      });

      childProcess.stderr.on('data', data => {
        stderrChunkCount++;
        const chunk = data.toString();

        debugLog('runAgentProcess', `stderr data received (chunk #${stderrChunkCount})`, {
          chunkLength: chunk.length,
          chunkPreview: chunk,
          totalStderrLength: stdErrBuffer.length + chunk.length,
        });

        stdErrBuffer += chunk;
      });
    });
  }
}
