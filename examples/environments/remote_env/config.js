// @ts-check

/**
 * @import {EnvironmentConfig} from 'web-codegen-scorer';
 */

import {
  EvalPromptWithMetadata,
  getBuiltInRatings,
  RatingKind,
  RatingCategory,
  RatingState,
} from 'web-codegen-scorer';
import {FakeRemoteExecutor} from './fake-executor';

/** @type {EnvironmentConfig} */
export default {
  displayName: 'Remote Env (example)',
  clientSideFramework: 'angular',
  ratings: [
    ...getBuiltInRatings(),
    {
      name: 'Test Metadata Rating',
      id: 'test-metadata-rating',
      kind: RatingKind.PER_BUILD,
      category: RatingCategory.MEDIUM_IMPACT,
      description: 'Testing the metadata of prompts',
      scoreReduction: '100%',
      rate: ctx => {
        const metadata = /** @type {{goldenURL: string}} */ (ctx.prompt.metadata);
        const found = ctx.generatedFiles.some(f => f.code.includes(metadata.goldenURL));

        return {
          state: RatingState.EXECUTED,
          coefficient: found ? 1 : 0,
          message: found ? `${metadata.goldenURL} found!` : `${metadata.goldenURL} not found!`,
        };
      },
    },
  ],
  generationSystemPrompt: './system-instructions.md',
  executablePrompts: [
    new EvalPromptWithMetadata(
      'test-app',
      `Create the Angular documentation website. Make sure you add a link to \`angular.dev\` in there.`,
      {
        metadata: {
          goldenURL: 'angular.dev',
        },
      },
    ),
  ],
  executor: new FakeRemoteExecutor(),
};
