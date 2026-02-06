import {UserFacingError} from '../utils/errors.js';
import type {GeminiCliRunner} from './gemini-cli-runner.js';
import type {ClaudeCodeRunner} from './claude-code-runner.js';
import type {CopilotCliRunner} from './copilot-cli-runner.js';
import type {CodexRunner} from './codex-runner.js';
import type {NoopUnimplementedRunner} from './noop-unimplemented-runner.js';
import {AiSdkRunner} from './ai-sdk/ai-sdk-runner.js';

interface AvailableRunners {
  'ai-sdk': AiSdkRunner;
  'gemini-cli': GeminiCliRunner;
  'claude-code': ClaudeCodeRunner;
  'copilot-cli': CopilotCliRunner;
  'codex': CodexRunner;
  'noop-unimplemented': NoopUnimplementedRunner;
}

/** Names of supported runners. */
export type RunnerName = keyof AvailableRunners;

/** Creates an `LlmRunner` based on a name. */
export async function getRunnerByName<T extends RunnerName>(name: T): Promise<AvailableRunners[T]> {
  switch (name) {
    case 'ai-sdk':
      return import('./ai-sdk/ai-sdk-runner.js').then(
        m => new m.AiSdkRunner() as AvailableRunners[T],
      );
    case 'gemini-cli':
      return import('./gemini-cli-runner.js').then(
        m => new m.GeminiCliRunner() as AvailableRunners[T],
      );
    case 'claude-code':
      return import('./claude-code-runner.js').then(
        m => new m.ClaudeCodeRunner() as AvailableRunners[T],
      );
    case 'copilot-cli':
      return import('./copilot-cli-runner.js').then(
        m => new m.CopilotCliRunner() as AvailableRunners[T],
      );
    case 'codex':
      return import('./codex-runner.js').then(m => new m.CodexRunner() as AvailableRunners[T]);
    case 'noop-unimplemented':
      return import('./noop-unimplemented-runner.js').then(
        m => new m.NoopUnimplementedRunner() as AvailableRunners[T],
      );
    default:
      throw new UserFacingError(`Unsupported runner ${name}`);
  }
}
