import { ProgressType } from '../progress/progress-logger.js';
import { PackageSummary } from '@safety-web/types';
import {
  AgentOutput,
  BrowserAgentTaskInput,
} from '../testing/browser-agent/models.js';
import { Result } from 'axe-core';
import { CspViolation } from './auto-csp-types.js';

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
  /** Command used to start a development server. */
  serveCommand: string;
  /**
   * Whether this application should be invoked via Puppeteer and
   * runtime errors should be collected and reported.
   */
  collectRuntimeErrors?: boolean;
  /**
   * Whether to take a screenshot of the application after a successful build.
   */
  takeScreenshots?: boolean;
  /**
   * Whether or not to perform Axe testing of the application after a successful build.
   */
  includeAxeTesting?: boolean;

  /** Whether to enable the auto CSP checks. */
  enableAutoCsp?: boolean;

  /** User journey browser agent task input */
  userJourneyAgentTaskInput?: BrowserAgentTaskInput;
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
  screenshotPngUrl?: string;
  missingDependency?: string;
  runtimeErrors?: string;
  /** JSON report from the Safety Web runner, if available. */
  safetyWebReportJson?: PackageSummary[];
  userJourneyAgentOutput: AgentOutput | null;
  cspViolations?: CspViolation[];
  axeViolations?: Result[];
}

export interface BuildResultMessage {
  type: 'build';
  payload: BuildResult;
}

export interface BuildProgressLogMessage {
  type: 'log';
  payload: {
    state: ProgressType;
    message: string;
    details?: string;
  };
}

export type BuilderProgressLogFn = (
  state: ProgressType,
  message: string,
  details?: string
) => void;

export type BuildWorkerResponseMessage =
  | BuildResultMessage
  | BuildProgressLogMessage;

export enum RepairType {
  Build = 'Build',
  Axe = 'Axe',
}
