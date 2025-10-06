// @ts-check

/**
 * @import {EnvironmentConfig} from 'web-codegen-scorer';
 */

import {getBuiltInRatings} from 'web-codegen-scorer';
import {FakeRemoteExecutor} from './fake-executor';

/** @type {EnvironmentConfig} */
export default {
  displayName: 'Remote Env (example)',
  clientSideFramework: 'angular',
  ratings: getBuiltInRatings(),
  generationSystemPrompt: './system-instructions.md',
  executablePrompts: ['../../prompts/**/*.md'],
  executor: new FakeRemoteExecutor(),
};
