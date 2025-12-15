import type {LlmContextFile, Usage} from '../../shared-interfaces.js';

/** Minimum rating that the LLM can assign. */
export const MIN_RATING = 1;

/** Maximum rating that the LLM can assign. */
export const MAX_RATING = 10;

/** Results of an automated rating. */
export interface AutoRateResult {
  coefficient: number;
  usage: Usage;
  details: {
    summary: string;
    categories: {name: string; message: string}[];
  };
}

/** Request for executor to auto-rate generated code. */
export interface ExecutorCodeAutoRateRequest {
  /** Prompt used for the rating. */
  ratingPrompt: string;
  /** Files that should be rated. */
  files: LlmContextFile[];
  /** Minimum score. */
  minRating: number;
  /** Maxmum score. */
  maxRating: number;
}

export interface ExecutorVisualAutoRateRequest {
  /** Prompt used for the rating. */
  ratingPrompt: string;
  /** URL to the image to be rated. */
  imageUrl: string;
  /** base64 representation of the image. */
  base64Image: string;
  /** Minimum score. */
  minRating: number;
  /** Maxmum score. */
  maxRating: number;
}

/** Response from the executor to an automated rating request. */
export interface ExecutorAutoRateResponse {
  /** Score of the rating. */
  rating: number;
  /** Text summary of the result. */
  summary: string;
  /** Categories of the rating and related descriptions. */
  categories: {name: string; message: string}[];
  /** Usage information about the auto rate request. */
  usage?: Usage;
}

export function getCoefficient(rating: number, maxRating: number): number {
  const percent = rating / maxRating;

  // More than 80% is a perfect score.
  if (percent >= 0.8) {
    return 1;
  }

  // More than 50% is a very good score, while everything else is a poor score.
  return percent >= 0.5 ? 0.75 : 0.25;
}
