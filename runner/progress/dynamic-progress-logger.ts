import { MultiBar, SingleBar, Presets } from 'cli-progress';
import chalk from 'chalk';
import { RootPromptDefinition } from '../shared-interfaces.js';
import {
  ProgressLogger,
  ProgressType,
  progressTypeToIcon,
} from './progress-logger.js';
import { redX } from '../reporting/format.js';

const PREFIX_WIDTH = 20;

/** A progress logger that logs the progression with a dynamic way. */
export class DynamicProgressLogger implements ProgressLogger {
  private wrapper: MultiBar | undefined;
  private totalBar: SingleBar | undefined;
  private pendingBars = new Map<RootPromptDefinition, SingleBar>();
  private spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private currentSpinnerFrame = 0;
  private spinnerInterval: ReturnType<typeof setInterval> | undefined;
  private errors: {
    prompt: RootPromptDefinition;
    message: string;
    details?: string;
  }[] = [];

  initialize(total: number): void {
    this.finalize();

    // Create a multi-bar as a container.
    this.wrapper = new MultiBar(
      {
        clearOnComplete: true,
        hideCursor: true,
        // We render one "bar" for each current eval. We use this mostly to show text since
        // there isn't an exact progress number for each eval.
        format: '{name} {message}',
        gracefulExit: true,
        // The implementation has some logic that won't redraw the progress bar unless the actual
        // value changed. We bypass this, because the progress value for the individual prompts
        // does change, only the status does. Without this option, we can occasionally get
        // duplicated prompts in the list.
        forceRedraw: true,
      },
      {
        ...Presets.rect,
        // Use a character so the bar is visible while it's empty.
        barIncompleteChar: '_',
      }
    );

    // Bar that tracks how many prompts are completed in total.
    this.totalBar = this.wrapper.create(total, 0, undefined, {
      format: '{bar} {spinner} {value}/{total} prompts completed',
      barsize: PREFIX_WIDTH,
    });

    // Interval to update the spinner.
    this.spinnerInterval = setInterval(() => {
      if (!this.totalBar) {
        clearInterval(this.spinnerInterval);
        return;
      }

      this.currentSpinnerFrame =
        this.currentSpinnerFrame >= this.spinnerFrames.length - 1
          ? 0
          : this.currentSpinnerFrame + 1;

      this.totalBar.update({
        spinner: this.spinnerFrames[this.currentSpinnerFrame],
      });
    }, 80);
  }

  finalize(): void {
    clearInterval(this.spinnerInterval);
    this.wrapper?.stop();
    this.pendingBars.clear();
    this.wrapper = this.totalBar = this.spinnerInterval = undefined;

    for (const error of this.errors) {
      let message = `${redX()} [${error.prompt.name}] ${error.message}`;
      if (error.details) {
        message += `\n  ${error.details}`;
      }
      console.error(message);
    }
  }

  log(
    prompt: RootPromptDefinition,
    type: ProgressType,
    message: string,
    details?: string
  ): void {
    if (!this.wrapper || !this.totalBar) {
      return;
    }

    let bar = this.pendingBars.get(prompt);

    // Drop the bar from the screen if it's complete.
    if (type === 'done') {
      this.pendingBars.delete(prompt);

      if (bar) {
        this.totalBar.increment();
        this.wrapper.remove(bar);
      }
      return;
    }

    // Capture errors for static printing once the dynamic progress is hidden.
    if (type === 'error') {
      this.errors.push({ prompt, message, details });
    }

    // Pad/trim the name so they're all the same length.
    const name = this.trimString(
      prompt.name.padEnd(PREFIX_WIDTH, ' '),
      PREFIX_WIDTH
    );
    const payload = {
      name: `${this.getColorFunction(type)(name)}`,
      message: `${progressTypeToIcon(type)} ${this.trimString(message, 100)}`,
    };

    if (bar) {
      bar.update(0, payload);
    } else {
      const bar = this.wrapper.create(1, 0, payload);
      this.pendingBars.set(prompt, bar);
    }
  }

  private getColorFunction(type: ProgressType): (value: string) => string {
    switch (type) {
      case 'done':
      case 'success':
      case 'serve-testing':
      case 'build':
        return chalk.green;
      case 'error':
        return chalk.red;
      case 'codegen':
        return chalk.cyan;
      case 'eval':
        return chalk.blueBright;
    }
  }

  private trimString(value: string, maxLength: number): string {
    return value.length > maxLength
      ? value.slice(0, maxLength - 1) + '…'
      : value;
  }
}
