import { LocalEnvironment } from './environment-local.js';
import { RemoteEnvironment } from './environment-remote.js';

export type Environment = LocalEnvironment | RemoteEnvironment;
