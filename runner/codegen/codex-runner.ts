import {LlmGenerateFilesRequestOptions, LlmRunner} from './llm-runner.js';
import {join} from 'path';
import {mkdirSync} from 'fs';
import {writeFile} from 'fs/promises';
import {BaseCliAgentRunner} from './base-cli-agent-runner.js';

const MODEL_MAPPING: Record<string, string> = {
  'openai-o3': 'o3',
  'openai-o4-mini': 'o4-mini',
  'openai-gpt-5': 'gpt-5-codex',
};

/** Runner that generates code using Codex. */
export class CodexRunner extends BaseCliAgentRunner implements LlmRunner {
  readonly id = 'codex';
  readonly displayName = 'Codex';
  readonly hasBuiltInRepairLoop = true;
  protected ignoredFilePatterns = ['**/AGENTS.md', '**/.codex/**'];
  protected binaryName = 'codex';

  getSupportedModels(): string[] {
    return Object.keys(MODEL_MAPPING);
  }

  protected getCommandLineFlags(options: LlmGenerateFilesRequestOptions): string[] {
    return [
      'exec',
      '--model',
      MODEL_MAPPING[options.model],
      // Skip all confirmations.
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      options.context.executablePrompt,
    ];
  }

  protected async writeAgentFiles(options: LlmGenerateFilesRequestOptions): Promise<void> {
    const {context} = options;
    const instructionFilePath = join(context.directory, 'AGENTS.md');
    const settingsDir = join(context.directory, '.codex');

    mkdirSync(settingsDir);

    await Promise.all([
      writeFile(join(settingsDir, 'config.toml'), this.getSettingsFile()),
      writeFile(instructionFilePath, super.getCommonInstructions(options)),
    ]);
  }

  private getSettingsFile(): string {
    return ['hide_agent_reasoning = true', ''].join('\n');
  }
}
