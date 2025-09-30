import {Usage} from '../../shared-interfaces.js';

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

export function getCoefficient(rating: number): number {
  const percent = rating / MAX_RATING;

  // More than 80% is a perfect score.
  if (percent >= 0.8) {
    return 1;
  }

  // More than 50% is a very good score, while everything else is a poor score.
  return percent >= 0.5 ? 0.75 : 0.25;
}
