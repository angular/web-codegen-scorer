import { ProgressType } from '../../progress/progress-logger.js';
import {
  AgentOutput,
  BrowserAgentTaskInput,
} from '../../testing/browser-agent/models.js';
import { Result } from 'axe-core';
import { CspViolation } from './auto-csp-types.js';

/**
 * Represents the message structure used for communication between
 * the main process and the serve-testing worker process.
 */
export interface ServeTestingWorkerMessage {
  /** URL where the app is running. */
  serveUrl: string;
  /** Name of the app. */
  appName: string;
  /**
   * Whether this application should be invoked via Puppeteer and
   * runtime errors should be collected and reported.
   */
  collectRuntimeErrors?: boolean;
  /**
   * Whether to take a screenshot of the application.
   */
  takeScreenshots?: boolean;
  /**
   * Whether or not to perform Axe testing of the application.
   */
  includeAxeTesting?: boolean;

  /** Whether to enable the auto CSP checks. */
  enableAutoCsp?: boolean;

  /** User journey browser agent task input */
  userJourneyAgentTaskInput?: BrowserAgentTaskInput;
}

export interface ServeTestingResult {
  errorMessage?: string;
  screenshotPngUrl?: string;
  missingDependency?: string;
  runtimeErrors?: string;
  userJourneyAgentOutput: AgentOutput | null;
  cspViolations?: CspViolation[];
  axeViolations?: Result[];
}

export interface ServeTestingResultMessage {
  type: 'result';
  payload: ServeTestingResult;
}

export interface ServeTestingProgressLogMessage {
  type: 'log';
  payload: {
    state: ProgressType;
    message: string;
    details?: string;
  };
}

export type ServeTestingProgressLogFn = (
  state: ProgressType,
  message: string,
  details?: string
) => void;

export type ServeTestingWorkerResponseMessage =
  | ServeTestingProgressLogMessage
  | ServeTestingResultMessage;
