import {ChildProcess, spawn} from 'child_process';
import {join, relative} from 'path';
import {existsSync} from 'fs';
import assert from 'assert';
import {
  LlmConstrainedOutputGenerateResponse,
  LlmGenerateFilesRequestOptions,
  LlmGenerateFilesResponse,
  LlmGenerateTextResponse,
} from './llm-runner.js';
import {DirectorySnapshot} from './directory-snapshot.js';
import {LlmResponseFile} from '../shared-interfaces.js';
import {UserFacingError} from '../utils/errors.js';

/** Base class for a command-line-based runner. */
export abstract class BaseCliAgentRunner {
  abstract readonly displayName: string;
  protected abstract readonly binaryName: string;
  protected abstract readonly ignoredFilePatterns: string[];
  protected abstract getCommandLineFlags(options: LlmGenerateFilesRequestOptions): string[];
  protected abstract writeAgentFiles(options: LlmGenerateFilesRequestOptions): Promise<void>;
  protected inactivityTimeoutMins = 2;
  protected totalRequestTimeoutMins = 10;

  private pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();
  private pendingProcesses = new Set<ChildProcess>();
  private binaryPath: string | null = null;
  private commonIgnoredPatterns = ['**/node_modules/**', '**/dist/**', '**/.angular/**'];

  async generateFiles(options: LlmGenerateFilesRequestOptions): Promise<LlmGenerateFilesResponse> {
    const {context} = options;

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
    const initialSnapshot = await DirectorySnapshot.forDirectory(
      context.directory,
      ignoredPatterns,
    );

    await this.writeAgentFiles(options);

    const reasoning = await this.runAgentProcess(options);
    const finalSnapshot = await DirectorySnapshot.forDirectory(context.directory, ignoredPatterns);

    const diff = finalSnapshot.getChangedOrAddedFiles(initialSnapshot);
    const files: LlmResponseFile[] = [];

    for (const [absolutePath, code] of diff) {
      files.push({
        filePath: relative(context.directory, absolutePath),
        code,
      });
    }

    return {files, reasoning, toolLogs: []};
  }

  generateText(): Promise<LlmGenerateTextResponse> {
    // Technically we can make this work, but we don't need it at the time of writing.
    throw new UserFacingError(`Generating text with ${this.displayName} is not supported.`);
  }

  generateConstrained(): Promise<LlmConstrainedOutputGenerateResponse<any>> {
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
  protected getCommonInstructions(options: LlmGenerateFilesRequestOptions) {
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
    let dir = import.meta.dirname;
    let closestRoot: string | null = null;

    // Attempt to resolve the agent CLI binary by starting at the current file and going up until
    // we find the closest `node_modules`. Note that we can't rely on `import.meta.resolve` here,
    // because that'll point us to the agent bundle, but not its binary. In some package
    // managers (pnpm specifically) the `node_modules` in which the file is installed is different
    // from the one in which the binary is placed.
    while (dir.length > 1) {
      if (existsSync(join(dir, 'node_modules'))) {
        closestRoot = dir;
        break;
      }

      const parent = join(dir, '..');

      if (parent === dir) {
        // We've reached the root, stop traversing.
        break;
      } else {
        dir = parent;
      }
    }

    const binaryPath = closestRoot ? join(closestRoot, `node_modules/.bin/${binaryName}`) : null;

    if (!binaryPath || !existsSync(binaryPath)) {
      throw new UserFacingError(`${this.displayName} is not installed inside the current project`);
    }

    return binaryPath;
  }

  private runAgentProcess(options: LlmGenerateFilesRequestOptions): Promise<string> {
    return new Promise<string>(resolve => {
      let stdoutBuffer = '';
      let stdErrBuffer = '';
      let isDone = false;
      const inactivityTimeoutMins = this.inactivityTimeoutMins;
      const totalRequestTimeoutMins = this.totalRequestTimeoutMins;
      const msPerMin = 1000 * 60;
      const finalize = (finalMessage: string) => {
        if (isDone) {
          return;
        }

        isDone = true;

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
        resolve(stdoutBuffer);
      };

      const noOutputCallback = () => {
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
        finalize(
          `${this.displayName} didn't finish within ${totalRequestTimeoutMins} minute(s). ` +
            `Stopping the process...`,
        );
      }, totalRequestTimeoutMins * msPerMin);

      this.binaryPath ??= this.resolveBinaryPath(this.binaryName);

      const childProcess = spawn(this.binaryPath, this.getCommandLineFlags(options), {
        cwd: options.context.directory,
        env: {...process.env},
      });

      // Important! some agents won't start executing until stdin has ended.
      childProcess.stdin.end();

      childProcess.on('close', code =>
        finalize(
          `${this.displayName} process has exited` + (code == null ? '.' : ` with ${code} code.`),
        ),
      );
      childProcess.stdout.on('data', data => {
        if (inactivityTimeout) {
          this.pendingTimeouts.delete(inactivityTimeout);
          clearTimeout(inactivityTimeout);
        }

        stdoutBuffer += data.toString();
        inactivityTimeout = setTimeout(noOutputCallback, inactivityTimeoutMins * msPerMin);
        this.pendingTimeouts.add(inactivityTimeout);
      });
      childProcess.stderr.on('data', data => {
        stdErrBuffer += data.toString();
      });
    });
  }
}
