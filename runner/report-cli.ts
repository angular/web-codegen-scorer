import { Arguments, Argv, CommandModule } from 'yargs';
import { join, relative } from 'path';
import { executeCommand } from './utils/exec.js';
import { REPORTS_ROOT_DIR } from './configuration/constants.js';
import { toProcessAbsolutePath } from './file-system-utils.js';
import { formatTitleCard } from './reporting/format.js';

export const ReportModule = {
  builder,
  handler,
  command: 'report',
  describe: 'View the codegen eval report',
} satisfies CommandModule<{}, Options>;

interface Options {
  /** Path from which to read local reports. */
  reportsDirectory?: string;

  /** Path to a JavaScript file to use to load remote reports and display them in the app. */
  reportsLoader?: string;
  port: number;
}

function builder(argv: Argv): Argv<Options> {
  return argv
    .option('reports-directory', {
      type: 'string',
      description: 'Path from which to read local reports',
      demandOption: false,
    })
    .option('reports-loader', {
      type: 'string',
      description:
        'Path to a JavaScript file to use to load remote reports and display them in the app',
      demandOption: false,
    })
    .option('port', {
      type: 'number',
      description: 'Port from which to serve the report UI',
      demandOption: false,
      default: 4200,
    })
    .version(false)
    .help();
}

async function handler(cliArgs: Arguments<Options>): Promise<void> {
  const reportsDir = cliArgs.reportsDirectory
    ? toProcessAbsolutePath(cliArgs.reportsDirectory)
    : REPORTS_ROOT_DIR;
  const environmentVariables: Record<string, string> = {
    CODEGEN_REPORTS_DIR: reportsDir,
    CODEGEN_REPORTS_PORT: cliArgs.port + '',
  };

  if (cliArgs.reportsLoader) {
    environmentVariables['CODEGEN_REPORTS_LOADER'] = toProcessAbsolutePath(
      cliArgs.reportsLoader
    );
  }

  console.log(
    formatTitleCard(
      [
        `View your reports at http://localhost:${cliArgs.port}`,
        `Reports are served from ${relative(process.cwd(), reportsDir)}`,
      ].join('\n')
    )
  );

  await executeCommand(
    'node report-app/server/server.mjs',
    join(import.meta.dirname, '..'),
    environmentVariables,
    { forwardStderrToParent: true, forwardStdoutToParent: true }
  );
}
