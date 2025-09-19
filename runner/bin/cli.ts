#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { EvalModule } from '../eval-cli.js';
import { ReportModule } from '../report-cli.js';
import { InitModule } from '../init-cli.js';
import { RunModule } from '../run-cli.js';

yargs()
  .scriptName('web-codegen-scorer')
  .demandCommand()
  .recommendCommands()
  .command(EvalModule.command, EvalModule.describe, EvalModule)
  .command(ReportModule.command, ReportModule.describe, ReportModule)
  .command(InitModule.command, InitModule.describe, InitModule)
  .command(RunModule.command, RunModule.describe, RunModule)
  .wrap(120)
  .strict()
  .help()
  .version(false)
  .parse(hideBin(process.argv));
