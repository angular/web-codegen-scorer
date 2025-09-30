import {RootPromptDefinition} from '../shared-interfaces.js';
import {ProgressLogger, ProgressType, progressTypeToIcon} from './progress-logger.js';

/** A progress logger that logs the progression as a flat stream of text. */
export class TextProgressLogger implements ProgressLogger {
  private total = 0;
  private done = 0;

  initialize(total: number): void {
    this.finalize();
    this.total = total;
  }

  finalize(): void {
    this.total = this.done = 0;
  }

  log(prompt: RootPromptDefinition, type: ProgressType, message: string, details?: string): void {
    const icon = progressTypeToIcon(type);

    if (type === 'done') {
      // It's handy to know how many apps are done when one completes.
      const suffix = `(${++this.done}/${this.total})`;
      details = details ? `${details} ${suffix}` : suffix;
    }

    console.log(`[${prompt.name}] ${icon} ${message} ${details || ''}`.trim());
  }
}
