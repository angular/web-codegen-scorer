import {LlmGenerateFilesRequestOptions, LlmRunner} from '../llm-runner.js';
import {join} from 'path';
import {mkdirSync} from 'fs';
import {writeFile} from 'fs/promises';
import {
  getGeminiIgnoreFile,
  getGeminiInstructionsFile,
  getGeminiSettingsFile,
} from './gemini-files.js';
import {BaseCliAgentRunner} from '../base-cli-agent-runner.js';

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

    const promises: Promise<unknown>[] = [writeFile(ignoreFilePath, getGeminiIgnoreFile())];

    if (context.buildCommand) {
      promises.push(
        writeFile(
          instructionFilePath,
          getGeminiInstructionsFile(context.systemInstructions, context.buildCommand),
        ),
      );
    }

    if (context.packageManager) {
      writeFile(
        join(settingsDir, 'settings.json'),
        getGeminiSettingsFile(context.packageManager, context.possiblePackageManagers),
      );
    }
  }
}
