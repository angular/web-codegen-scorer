import { greenCheckmark, redX } from '../reporting/format.js';
import { RootPromptDefinition } from '../shared-interfaces.js';

/** Possible progress event types. */
export type ProgressType =
  | 'codegen'
  | 'build'
  | 'serve-testing'
  | 'success'
  | 'error'
  | 'eval'
  | 'done';

/** Maps a ProgressType to an icon that can represent it. */
export function progressTypeToIcon(type: ProgressType): string {
  // Note: use a switch so we get a compilation error if there's a type we haven't accounted for.
  switch (type) {
    case 'codegen':
      return '🤖';
    case 'build':
      return '🔨';
    case 'serve-testing':
      return '🌊';
    case 'success':
      return greenCheckmark();
    case 'error':
      return redX();
    case 'eval':
      return '🔎';
    case 'done':
      return '🏁';
  }
}

/** Object used to log progress information about the eval. */
export interface ProgressLogger {
  /**
   * Initializes the logging process.
   * @param total Total number of prompts in the run.
   */
  initialize(total: number): void;

  /** Stops the logging process. */
  finalize(): void;

  /**
   * Logs a progress event to the logger.
   * @param prompt Prompt associated with the event.
   * @param type Type of the event.
   * @param message Message associated with the event.
   * @param details Additional information about the event.
   */
  log(
    prompt: RootPromptDefinition,
    type: ProgressType,
    message: string,
    details?: string
  ): void;
}
