import { ChildProcess, spawn } from 'child_process';
import {
  LlmConstrainedOutputGenerateResponse,
  LlmGenerateFilesContext,
  LlmGenerateFilesRequestOptions,
  LlmGenerateFilesResponse,
  LlmGenerateTextResponse,
  LlmRunner,
} from '../llm-runner.js';
import { join, relative } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import {
  getGeminiIgnoreFile,
  getGeminiInstructionsFile,
  getGeminiSettingsFile,
} from './gemini-files.js';
import { DirectorySnapshot } from './directory-snapshot.js';
import { LlmResponseFile } from '../../shared-interfaces.js';
import { UserFacingError } from '../../utils/errors.js';
import assert from 'assert';

const SUPPORTED_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

/** Runner that generates code using the Gemini CLI. */
export class GeminiCliRunner implements LlmRunner {
  readonly id = 'gemini-cli';
  readonly displayName = 'Gemini CLI';
  readonly hasBuiltInRepairLoop = true;
  private pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();
  private pendingProcesses = new Set<ChildProcess>();
  private binaryPath = this.resolveBinaryPath();
  private evalIgnoredPatterns = [
    '**/node_modules/**',
    '**/dist/**',
    '**/.angular/**',
    '**/GEMINI.md',
    '**/.geminiignore',
  ];

  async generateFiles(
    options: LlmGenerateFilesRequestOptions
  ): Promise<LlmGenerateFilesResponse> {
    const { context, model } = options;

    // TODO: Consider removing these assertions when we have better types here.
    // These fields are always set when running in a local environment, and this
    // is a requirement for selecting the `gemini-cli` runner.
    assert(
      context.buildCommand,
      'Expected a `buildCommand` to be set in the LLM generate request context'
    );
    assert(
      context.packageManager,
      'Expected a `packageManager` to be set in the LLM generate request context'
    );

    const ignoreFilePath = join(context.directory, '.geminiignore');
    const instructionFilePath = join(context.directory, 'GEMINI.md');
    const settingsDir = join(context.directory, '.gemini');
    const initialSnapshot = await DirectorySnapshot.forDirectory(
      context.directory,
      this.evalIgnoredPatterns
    );

    mkdirSync(settingsDir);

    await Promise.all([
      writeFile(ignoreFilePath, getGeminiIgnoreFile()),
      writeFile(
        instructionFilePath,
        getGeminiInstructionsFile(
          context.systemInstructions,
          context.buildCommand
        )
      ),
      writeFile(
        join(settingsDir, 'settings.json'),
        getGeminiSettingsFile(
          context.packageManager,
          context.possiblePackageManagers
        )
      ),
    ]);

    const reasoning = await this.runGeminiProcess(model, context, 2, 10);
    const finalSnapshot = await DirectorySnapshot.forDirectory(
      context.directory,
      this.evalIgnoredPatterns
    );

    const diff = finalSnapshot.getChangedOrAddedFiles(initialSnapshot);
    const files: LlmResponseFile[] = [];

    for (const [absolutePath, code] of diff) {
      files.push({
        filePath: relative(context.directory, absolutePath),
        code,
      });
    }

    return { files, reasoning, toolLogs: [] };
  }

  generateText(): Promise<LlmGenerateTextResponse> {
    // Technically we can make this work, but we don't need it at the time of writing.
    throw new UserFacingError(
      'Generating text with Gemini CLI is not supported.'
    );
  }

  generateConstrained(): Promise<LlmConstrainedOutputGenerateResponse<any>> {
    // We can't support this, because there's no straightforward
    // way to tell the Gemini CLI to follow a schema.
    throw new UserFacingError(
      'Constrained output with Gemini CLI is not supported.'
    );
  }

  getSupportedModels(): string[] {
    return SUPPORTED_MODELS;
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

  private resolveBinaryPath(): string {
    let dir = import.meta.dirname;
    let closestRoot: string | null = null;

    // Attempt to resolve the Gemini CLI binary by starting at the current file and going up until
    // we find the closest `node_modules`. Note that we can't rely on `import.meta.resolve` here,
    // because that'll point us to the Gemini CLI bundle, but not its binary. In some package
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

    const binaryPath = closestRoot
      ? join(closestRoot, 'node_modules/.bin/gemini')
      : null;

    if (!binaryPath || !existsSync(binaryPath)) {
      throw new UserFacingError(
        'Gemini CLI is not installed inside the current project'
      );
    }

    return binaryPath;
  }

  private runGeminiProcess(
    model: string,
    context: LlmGenerateFilesContext,
    inactivityTimeoutMins: number,
    totalRequestTimeoutMins: number
  ): Promise<string> {
    return new Promise<string>((resolve) => {
      let stdoutBuffer = '';
      let stdErrBuffer = '';
      let isDone = false;
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

        const separator =
          '\n--------------------------------------------------\n';

        if (stdErrBuffer.length > 0) {
          stdoutBuffer += separator + 'Stderr output:\n' + stdErrBuffer;
        }

        stdoutBuffer += separator + finalMessage;
        resolve(stdoutBuffer);
      };

      const noOutputCallback = () => {
        finalize(
          `There was no output from Gemini CLI for ${inactivityTimeoutMins} minute(s). ` +
            `Stopping the process...`
        );
      };

      // Gemini can get into a state where it stops outputting code, but it also doesn't exit
      // the process. Stop if there hasn't been any output for a certain amount of time.
      let inactivityTimeout = setTimeout(
        noOutputCallback,
        inactivityTimeoutMins * msPerMin
      );
      this.pendingTimeouts.add(inactivityTimeout);

      // Also add a timeout for the entire codegen process.
      const globalTimeout = setTimeout(() => {
        finalize(
          `Gemini CLI didn't finish within ${totalRequestTimeoutMins} minute(s). ` +
            `Stopping the process...`
        );
      }, totalRequestTimeoutMins * msPerMin);

      const childProcess = spawn(
        this.binaryPath,
        [
          '--prompt',
          context.executablePrompt,
          '--model',
          model,
          // Skip all confirmations.
          '--approval-mode',
          'yolo',
        ],
        {
          cwd: context.directory,
          env: { ...process.env },
        }
      );

      childProcess.on('close', (code) =>
        finalize(
          'Gemini CLI process has exited' +
            (code == null ? '.' : ` with ${code} code.`)
        )
      );
      childProcess.stdout.on('data', (data) => {
        if (inactivityTimeout) {
          this.pendingTimeouts.delete(inactivityTimeout);
          clearTimeout(inactivityTimeout);
        }

        stdoutBuffer += data.toString();
        inactivityTimeout = setTimeout(
          noOutputCallback,
          inactivityTimeoutMins * msPerMin
        );
        this.pendingTimeouts.add(inactivityTimeout);
      });
      childProcess.stderr.on('data', (data) => {
        stdErrBuffer += data.toString();
      });
    });
  }
}
