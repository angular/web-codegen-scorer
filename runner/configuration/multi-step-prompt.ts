import {Rating} from '../ratings/rating-types.js';

/** Definition of a multi-step prompt. */
export class MultiStepPrompt {
  constructor(
    readonly directoryPath: string,
    readonly stepRatings: Record<string, Rating[]> = {},
  ) {}
}
