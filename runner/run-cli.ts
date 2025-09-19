import { Arguments, Argv, CommandModule } from 'yargs';
import chalk from 'chalk';
import process from 'process';
import { getEnvironmentByPath } from './configuration/environment-resolution.js';
import {
  BUILT_IN_ENVIRONMENTS,
  LLM_OUTPUT_DIR,
} from './configuration/constants.js';
import { UserFacingError } from './utils/errors.js';
import { existsSync, rmSync } from 'fs';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { glob } from 'tinyglobby';
import { LlmResponseFile } from './shared-interfaces.js';
import {
  setupProjectStructure,
  writeResponseFiles,
} from './orchestration/file-system.js';
import { serveApp } from './builder/serve-app.js';
import { ProgressLogger, ProgressType } from './progress/progress-logger.js';
import { formatTitleCard } from './reporting/format.js';

export const RunModule = {
  builder,
  handler,
  command: 'run',
  describe: 'Run an evaluated app locally',
} satisfies CommandModule<{}, Options>;

interface Options {
  environment: string;
  prompt: string;
}

function builder(argv: Argv): Argv<Options> {
  return argv
    .option('environment', {
      type: 'string',
      alias: ['env'],
      default: '',
      description: 'Path to the environment configuration file',
    })
    .option('prompt', {
      type: 'string',
      default: '',
      description: 'ID of the prompt within the environment that should be run',
    })
    .version(false)
    .help();
}

async function handler(options: Arguments<Options>): Promise<void> {
  try {
    await runApp(options);
  } catch (error) {
    if (error instanceof UserFacingError) {
      console.error(chalk.red(error.message));
    } else {
      throw error;
    }
  }
}

async function runApp(options: Options) {
  const { environment, rootPromptDef, files } = await resolveConfig(options);
  const progress = new ErrorOnlyProgressLogger();

  console.log(
    `Setting up the "${environment.displayName}" environment with the "${rootPromptDef.name}" prompt...`
  );

  const { directory, cleanup } = await setupProjectStructure(
    environment,
    rootPromptDef,
    progress
  );

  const processExitPromise = new Promise<void>((resolve) => {
    const done = () => {
      () => {
        try {
          // Note: we don't use `cleanup` here, because the call needs to be synchronous.
          rmSync(directory, { recursive: true });
        } catch {}
        resolve();
      };
    };

    process.on('exit', done);
    process.on('close', done);
    process.on('SIGINT', done);
  });

  try {
    await writeResponseFiles(directory, files, environment, rootPromptDef.name);

    await serveApp(
      environment.serveCommand,
      rootPromptDef.name,
      directory,
      () => {},
      async (url) => {
        console.log();
        console.log(formatTitleCard(`🎉 App is up and running at ${url}`));
        await processExitPromise;
      }
    );
  } finally {
    await cleanup();
  }
}

async function resolveConfig(options: Options) {
  if (!options.environment) {
    throw new UserFacingError(
      [
        '`--env` flag has not been specified. You have the following options:',
        ' - Pass a path to an environment config file using the `--env` flag.',
        ' - Pass `--env=angular-example` or `--env=solid-example` to use one of our built-in example environments.',
        ' - Pass `--help` to see all available options.',
      ].join('\n')
    );
  } else if (!options.prompt) {
    throw new UserFacingError(
      '`--prompt` flag has not been specified. ' +
        'You have to pass a prompt name through the `--prompt` flag.'
    );
  }

  const environment = await getEnvironmentByPath(
    BUILT_IN_ENVIRONMENTS.get(options.environment) || options.environment
  );
  const environmentDir = join(LLM_OUTPUT_DIR, environment.id);

  if (!existsSync(environmentDir)) {
    throw new UserFacingError(
      `Could not find any LLM output for environment "${environment.displayName}" under "${environmentDir}"`
    );
  }

  const prompts = await getPossiblePrompts(environmentDir);

  if (!prompts.includes(options.prompt)) {
    throw new UserFacingError(
      `There is no local LLM output for environment "${options.prompt}".\n` +
        `The following prompts have local data:\n` +
        prompts.map((p) => ` - ${p}`).join('\n')
    );
  }

  const rootPromptDef = environment.executablePrompts.find(
    (p) => p.name === options.prompt
  );

  if (!rootPromptDef) {
    throw new UserFacingError(
      `Environment "${environment.displayName}" does not have a prompt with a name of "${options.prompt}".\n` +
        `The following prompts are available:\n` +
        environment.executablePrompts.map((p) => ` - ${p.name}`).join('\n')
    );
  }

  const promptDir = join(environmentDir, options.prompt);
  const filePaths = await glob('**/*', { cwd: promptDir });
  const files: LlmResponseFile[] = await Promise.all(
    filePaths.map(async (path) => {
      return {
        filePath: path,
        code: await readFile(join(promptDir, path), 'utf8'),
      };
    })
  );

  return { environment, rootPromptDef, files };
}

async function getPossiblePrompts(environmentDir: string): Promise<string[]> {
  const entities = await readdir(environmentDir, { withFileTypes: true });
  return entities
    .filter((entity) => entity.isDirectory())
    .map((entity) => entity.name);
}

class ErrorOnlyProgressLogger implements ProgressLogger {
  initialize(): void {}
  finalize(): void {}

  log(_: unknown, type: ProgressType, message: string, details?: string) {
    if (type === 'error') {
      console.error(chalk.red(message));

      if (details) {
        console.error(chalk.red(message));
      }
    }
  }
}
