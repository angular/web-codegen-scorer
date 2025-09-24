import { ProgressLogger } from './progress-logger.js';

/** A noop progress logger */
export class NoopProgressLogger implements ProgressLogger {
  initialize(): void {}
  finalize(): void {}
  log(): void {}
}
