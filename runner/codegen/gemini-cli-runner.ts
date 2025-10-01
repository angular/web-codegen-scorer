import {LlmGenerateFilesRequestOptions, LlmRunner} from './llm-runner.js';
import {join} from 'path';
import {mkdirSync} from 'fs';
import {writeFile} from 'fs/promises';
import {BaseCliAgentRunner} from './base-cli-agent-runner.js';

const SUPPORTED_MODELS = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];

/** Runner that generates code using the Gemini CLI. */
export class GeminiCliRunner extends BaseCliAgentRunner implements LlmRunner {
  readonly id = 'gemini-cli';
  readonly displayName = 'Gemini CLI';
  readonly hasBuiltInRepairLoop = true;
  protected ignoredFilePatterns = ['**/GEMINI.md', '**/.geminiignore'];
  protected binaryName = 'gemini';

  getSupportedModels(): string[] {
    return SUPPORTED_MODELS;
  }

  protected getCommandLineFlags(options: LlmGenerateFilesRequestOptions): string[] {
    return [
      '--prompt',
      options.context.executablePrompt,
      '--model',
      options.model,
      // Skip all confirmations.
      '--approval-mode',
      'yolo',
    ];
  }

  protected async writeAgentFiles(options: LlmGenerateFilesRequestOptions): Promise<void> {
    const {context} = options;
    const ignoreFilePath = join(context.directory, '.geminiignore');
    const instructionFilePath = join(context.directory, 'GEMINI.md');
    const settingsDir = join(context.directory, '.gemini');

    mkdirSync(settingsDir);

    const commonIgnorePatterns = super.getCommonIgnorePatterns();
    const ignoreFileContent = [
      ...commonIgnorePatterns.directories,
      ...commonIgnorePatterns.files,
    ].join('\n');

    const promises: Promise<unknown>[] = [
      writeFile(ignoreFilePath, ignoreFileContent),
      writeFile(instructionFilePath, super.getCommonInstructions(options)),
    ];

    if (context.packageManager) {
      writeFile(
        join(settingsDir, 'settings.json'),
        this.getGeminiSettingsFile(context.packageManager, context.possiblePackageManagers),
      );
    }

    await Promise.all(promises);
  }

  private getGeminiSettingsFile(packageManager: string, possiblePackageManagers: string[]): string {
    const config = {
      excludeTools: [
        // Prevent Gemini from using version control and package
        // managers since doing so via prompting doesn't always work.
        'run_shell_command(git)',
        ...possiblePackageManagers
          .filter(m => m !== packageManager)
          .map(m => `run_shell_command(${m})`),

        // Note that we don't block all commands,
        // because the build commands also go through it.
        `run_shell_command(${packageManager} install)`,
        `run_shell_command(${packageManager} add)`,
        `run_shell_command(${packageManager} remove)`,
        `run_shell_command(${packageManager} update)`,
        `run_shell_command(${packageManager} list)`,
      ],
    };

    return JSON.stringify(config, null, 2);
  }
}
