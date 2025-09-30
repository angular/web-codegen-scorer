import {logger} from 'genkit/logging';

const defaultLogger = logger.defaultLogger;

/** Custom logger for Genkit. */
export class GenkitLogger {
  private pendingLogs: unknown[] = [];
  private isCapturingLogs = false;
  level = defaultLogger.level;

  info(...args: unknown[]): void {
    this.maybeCapture(args);
    defaultLogger.info(...args);
  }

  debug(...args: unknown[]): void {
    this.maybeCapture(args);
    defaultLogger.debug(...args);
  }

  error(...args: unknown[]): void {
    this.maybeCapture(args);
    defaultLogger.error(...args);
  }

  warn(...args: unknown[]): void {
    this.maybeCapture(args);
    defaultLogger.warn(...args);
  }

  shouldLog(targetLevel: string): boolean {
    return this.level === targetLevel;
  }

  startCapturingLogs(): void {
    if (this.isCapturingLogs) {
      throw new Error('Logger is already capturing logs');
    }

    this.isCapturingLogs = true;
  }

  flushCapturedLogs(): unknown[] {
    if (!this.isCapturingLogs) {
      throw new Error('Logger is not capturing logs');
    }

    const logs = this.pendingLogs;
    this.pendingLogs = [];
    this.isCapturingLogs = false;
    return logs;
  }

  private maybeCapture(logs: unknown[]): void {
    if (this.isCapturingLogs) {
      this.pendingLogs.push(...logs);
    }
  }
}
