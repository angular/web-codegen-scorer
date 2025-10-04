import {Result as AxeResult} from 'axe-core';
import {RunnerResult as LighthouseRunnerResult} from 'lighthouse';
import {ProgressType} from '../../progress/progress-logger.js';
import {AgentOutput, BrowserAgentTaskInput} from '../../testing/browser-agent/models.js';
import {CspViolation} from './auto-csp-types.js';

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
   * Whether to take a screenshot of the application.
   */
  takeScreenshots: boolean;
  /**
   * Whether or not to perform Axe testing of the application.
   */
  includeAxeTesting: boolean;

  /** Whether to enable the auto CSP checks. */
  enableAutoCsp: boolean;

  /** User journey browser agent task input. */
  userJourneyAgentTaskInput: BrowserAgentTaskInput | undefined;

  /** Whether to capture Lighthouse data for the run. */
  includeLighthouseData: boolean;
}

export interface ServeTestingResult {
  errorMessage?: string;
  screenshotPngUrl?: string;
  runtimeErrors?: string;
  userJourneyAgentOutput: AgentOutput | null;
  cspViolations?: CspViolation[];
  axeViolations?: AxeResult[];
  lighthouseResult?: LighthouseResult;
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
  details?: string,
) => void;

export type ServeTestingWorkerResponseMessage =
  | ServeTestingProgressLogMessage
  | ServeTestingResultMessage;

export type LighthouseAudit = LighthouseRunnerResult['lhr']['audits']['x']; // Lighthouse doesn't export this so we need to dig for it.

export interface LighthouseCategory {
  id: string;
  displayName: string;
  description: string;
  score: number;
  audits: LighthouseAudit[];
}

export interface LighthouseResult {
  categories: LighthouseCategory[];
  uncategorized: LighthouseAudit[];
}
