/**
 * IMPORTANT: KEEP these interfaces in sync WITH `main.py` and `models.py`.
 */

import {UserJourneyDefinition} from '../../orchestration/user-journeys.js';

export interface BrowserAgentTaskInput {
  userJourneys: UserJourneyDefinition[];
  appPrompt: string;
}

/**
 * Details about a failed step in a user journey.
 */
export interface Failure {
  /**
   * The step number where the failure occurred.
   */
  step: number;
  /**
   * The observed behavior that deviated from the expectation.
   */
  observed: string;
  /**
   * The expected behavior for the failed step.
   */
  expected: string;
  /**
   * Base64 encoded screenshot of the failure.
   */
  screenshot: string;
}

/**
 * Analysis of a single User Journey.
 */
export interface UserJourneyAnalysis {
  /**
   * The name of the User Journey.
   */
  journey: string;
  /**
   * Whether the User Journey passed or not.
   */
  passing: boolean;
  /**
   * The sequence of steps executed for the user journey.
   */
  steps: string[];
  /**
   * Details of the failure, if user journey failed.
   */
  failure?: Failure;
}

/**
 * Evaluation of a single quality category.
 */
export interface Category {
  /**
   * The name of the quality category being evaluated.
   */
  name: string;
  /**
   * A concise summary of missing or improvement areas. Can be empty if none.
   */
  message: string;
}

/**
 * Holistic quality evaluation of the application.
 */
export interface QualityEvaluation {
  /**
   * An overall quality rating from 1 to 10.
   */
  rating: number;
  /**
   * A concise summary of the application's key features and overall quality.
   */
  summary: string;
  /**
   * A list of detailed evaluations for each quality category.
   */
  categories: Category[];
}

/**
 * The final structured output from the agent.
 */
export type AgentOutput =
  | {
      /**
       * An array of user journey analysis objects.
       */
      analysis: UserJourneyAnalysis[];
      /**
       * The overall quality evaluation.
       */
      qualityEvaluation: QualityEvaluation;
      /** Errors of the Agent. */
      errors: undefined;
    }
  | {
      errors: unknown[];
    };
