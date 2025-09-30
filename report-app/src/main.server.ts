import {bootstrapApplication} from '@angular/platform-browser';
import {App} from './app/app';
import {serverConfig} from './app/app.config.server';

const bootstrap = () => bootstrapApplication(App, serverConfig);

export default bootstrap;
