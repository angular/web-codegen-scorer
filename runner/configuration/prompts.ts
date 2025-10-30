import {Rating} from '../ratings/rating-types.js';

export interface EvalPromptOptions<M> {
  metadata: M;
  contextFilePatterns?: string[];
  extraRatings?: Rating[];
}

/** Definition of a single-step prompt with metadata. */
export class EvalPromptWithMetadata<Metadata> {
  constructor(
    readonly name: string,
    readonly text: string,
    readonly opts: EvalPromptOptions<Metadata>,
  ) {}
}

/** Definition of a single-step prompt. */
export class EvalPrompt extends EvalPromptWithMetadata<undefined> {
  constructor(
    name: string,
    text: string,
    opts: Omit<EvalPromptOptions<undefined>, 'metadata'> = {},
  ) {
    super(name, text, {...opts, metadata: undefined});
  }
}

/** Definition of a multi-step prompt. */
export class MultiStepPrompt {
  constructor(
    readonly directoryPath: string,
    readonly stepRatings: Record<string, Rating[]> = {},
    readonly stepMetadata: Record<string, unknown> = {},
  ) {}
}
