// @ts-check

/**
 * @import {RemoteEnvironmentConfig} from 'web-codegen-scorer';
 */

import { getBuiltInRatings } from 'web-codegen-scorer';
import { FakeRemoteGateway } from './fake-gateway';

/** @type {RemoteEnvironmentConfig} */
export default {
  displayName: 'Remote Env (example)',
  clientSideFramework: 'angular',
  ratings: getBuiltInRatings(),
  generationSystemPrompt: './system-instructions.md',
  executablePrompts: ['../../prompts/**/*.md'],
  gateway: new FakeRemoteGateway(),
};
