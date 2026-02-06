import {
  LocalLlmGenerateFilesContext,
  LocalLlmGenerateFilesRequestOptions,
  LlmRunner,
} from './llm-runner.js';
import {join} from 'path';
import {existsSync, mkdirSync} from 'fs';
import {writeFile} from 'fs/promises';
import {BaseCliAgentRunner} from './base-cli-agent-runner.js';

// Models available in Copilot CLI (default is Claude Sonnet 4.5)
const SUPPORTED_MODELS = [
  // Claude models
  'claude-sonnet-4.5',
  'claude-haiku-4.5',
  'claude-opus-4.5',
  'claude-sonnet-4',
  // Gemini models
  'gemini-3-pro-preview',
  // GPT models
  'gpt-5.2-codex',
  'gpt-5.2',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex',
  'gpt-5.1',
  'gpt-5',
  'gpt-5.1-codex-mini',
  'gpt-5-mini',
  'gpt-4.1',
];

/** Runner that generates code using GitHub Copilot CLI (@github/copilot). */
export class CopilotCliRunner extends BaseCliAgentRunner implements LlmRunner {
  readonly id = 'copilot-cli';
  readonly displayName = 'GitHub Copilot CLI';
  readonly hasBuiltInRepairLoop = true;
  protected ignoredFilePatterns = ['**/COPILOT.md', '**/.copilot/**'];
  protected binaryName = 'copilot';

  // Copilot outputs at the end, so bump the inactivity timeout
  protected override inactivityTimeoutMins = 10;
  protected override totalRequestTimeoutMins = 15;

  getSupportedModels(): string[] {
    return SUPPORTED_MODELS;
  }

  protected getCommandLineFlags(options: LocalLlmGenerateFilesRequestOptions): string[] {
    const flags = [
      // Non-interactive mode with prompt
      '--prompt',
      options.context.executablePrompt,
      // Allow all tools without asking for approval
      '--allow-all-tools',
    ];

    // Add model if specified
    if (options.model && SUPPORTED_MODELS.includes(options.model)) {
      flags.push('--model', options.model);
    }

    return flags;
  }

  protected async writeAgentFiles(options: LocalLlmGenerateFilesRequestOptions): Promise<void> {
    const {context} = options;
    const instructionFilePath = join(context.directory, 'COPILOT.md');
    const settingsDir = join(context.directory, '.copilot');

    if (!existsSync(settingsDir)) {
      mkdirSync(settingsDir);
    }

    await Promise.all([
      writeFile(join(settingsDir, 'settings.json'), this.getSettingsJsonFile(context)),
      writeFile(instructionFilePath, super.getCommonInstructions(options)),
    ]);
  }

  private getSettingsJsonFile(context: LocalLlmGenerateFilesContext): string {
    const ignoredPatterns = super.getCommonIgnorePatterns();

    // Copilot CLI uses similar permission patterns to Claude Code
    const denyTools: string[] = [
      // Block git commands
      'shell(git:*)',
      // Block reading ignored directories
      ...ignoredPatterns.directories.map(dir => `read(${join(dir, '**')})`),
      ...ignoredPatterns.files.map(file => `read(${file})`),
      // Block other package managers
      ...context.possiblePackageManagers
        .filter(manager => manager !== context.packageManager)
        .map(manager => `shell(${manager}:*)`),
      // Block package installation commands
      `shell(${context.packageManager} install:*)`,
      `shell(${context.packageManager} add:*)`,
      `shell(${context.packageManager} remove:*)`,
      `shell(${context.packageManager} update:*)`,
    ];

    return JSON.stringify(
      {
        permissions: {
          deny: denyTools,
        },
      },
      undefined,
      2,
    );
  }
}
