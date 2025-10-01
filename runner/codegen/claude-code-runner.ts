import {LlmGenerateFilesContext, LlmGenerateFilesRequestOptions, LlmRunner} from './llm-runner.js';
import {join} from 'path';
import {mkdirSync} from 'fs';
import {writeFile} from 'fs/promises';
import {BaseCliAgentRunner} from './base-cli-agent-runner.js';

const MODEL_MAPPING: Record<string, string> = {
  'claude-4.0-sonnet': 'claude-sonnet-4-20250514',
  'claude-3.5-haiku': 'claude-3-5-haiku-latest',
};

/** Runner that generates code using the Claude Code. */
export class ClaudeCodeRunner extends BaseCliAgentRunner implements LlmRunner {
  readonly id = 'claude-code';
  readonly displayName = 'Claude Code';
  readonly hasBuiltInRepairLoop = true;
  protected ignoredFilePatterns = ['**/CLAUDE.md', '**/.claude/**'];
  protected binaryName = 'claude';
  protected override inactivityTimeoutMins = 10;
  protected override totalRequestTimeoutMins = 10;

  getSupportedModels(): string[] {
    return Object.keys(MODEL_MAPPING);
  }

  protected getCommandLineFlags(options: LlmGenerateFilesRequestOptions): string[] {
    return [
      '--print',
      '--model',
      MODEL_MAPPING[options.model],
      // Skip all confirmations.
      '--dangerously-skip-permissions',
      '--permission-mode',
      'bypassPermissions',
      '--verbose',
      options.context.executablePrompt,
    ];
  }

  protected async writeAgentFiles(options: LlmGenerateFilesRequestOptions): Promise<void> {
    const {context} = options;
    const instructionFilePath = join(context.directory, 'CLAUDE.md');
    const settingsDir = join(context.directory, '.claude');

    mkdirSync(settingsDir);

    await Promise.all([
      writeFile(join(settingsDir, 'settings.json'), this.getSettingsJsonFile(options.context)),
      writeFile(instructionFilePath, super.getCommonInstructions(options)),
    ]);
  }

  private getSettingsJsonFile(context: LlmGenerateFilesContext): string {
    const ignoredPatterns = super.getCommonIgnorePatterns();
    const deniedPermissions: string[] = [
      // Block some commands like `git` and `npm install` since they aren't relevant for the evals.
      'Bash(git:*)',
      ...ignoredPatterns.directories.map(dir => `"Read(${join(dir, '**')})"`),
      ...ignoredPatterns.files.map(file => `"Read(${file})"`),
      ...context.possiblePackageManagers
        .filter(manager => manager !== context.packageManager)
        .map(manager => `Bash(${manager}:*)`),

      // Note that we don't block all commands,
      // because the build commands also go through it.
      `Bash(${context.packageManager} install:*)`,
      `Bash(${context.packageManager} add:*)`,
      `Bash(${context.packageManager} remove:*)`,
      `Bash(${context.packageManager} update:*)`,
      `Bash(${context.packageManager} list:*)`,
    ];

    return JSON.stringify(
      {
        permissions: {
          deny: deniedPermissions,
        },
        env: {
          DISABLE_AUTOUPDATER: 1,
          DISABLE_TELEMETRY: 1,
          DISABLE_ERROR_REPORTING: 1,
        },
      },
      undefined,
      2,
    );
  }
}
