import { PackageSummary } from '@safety-web/types';

/**
 * Represents the message structure used for communication between
 * the main process and the build worker process.
 */
export interface BuildWorkerMessage {
  directory: string;
  /** Name of the app. */
  appName: string;
  /** Command used to build the app. */
  buildCommand: string;
}

export enum BuildResultStatus {
  SUCCESS = 'success',
  ERROR = 'error',
}

export enum BuildErrorType {
  MISSING_DEPENDENCY = 'Missing Dependency', // "[ERROR] Could not resolve"
  TYPESCRIPT_ERROR = 'TypeScript Error', // "[ERROR] TS\d+"
  ANGULAR_DIAGNOSTIC = 'Angular Diagnostic', // "[ERROR] NG\d+"
  OTHER = 'Other',
}

export interface BuildResult {
  status: BuildResultStatus;
  message: string;
  errorType?: BuildErrorType;
  missingDependency?: string;
  /** JSON report from the Safety Web runner, if available. */
  safetyWebReportJson?: PackageSummary[];
}

export interface BuildResultMessage {
  type: 'build';
  payload: BuildResult;
}

export type BuildWorkerResponseMessage = BuildResultMessage;
