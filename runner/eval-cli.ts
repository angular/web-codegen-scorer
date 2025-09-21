import { Arguments, Argv, CommandModule } from 'yargs';
import chalk from 'chalk';
import { assertValidModelName, LlmRunner } from './codegen/llm-runner.js';
import {
  BUILT_IN_ENVIRONMENTS,
  DEFAULT_AUTORATER_MODEL_NAME,
  DEFAULT_MODEL_NAME,
} from './configuration/constants.js';
import { generateCodeAndAssess } from './orchestration/generate.js';
import {
  logReportToConsole,
  writeReportToDisk,
} from './reporting/report-logging.js';
import { getRunnerByName, RunnerName } from './codegen/runner-creation.js';
import { GenkitRunner } from './codegen/genkit/genkit-runner.js';
import { UserFacingError } from './utils/errors.js';

export const EvalModule = {
  builder,
  handler,
  command: 'eval',
  describe: 'Evaluate code using an LLM',
} satisfies CommandModule<{}, Options>;

interface Options {
  environment?: string;
  model: string;
  runner: string;
  local: boolean;
  limit: number;
  concurrency: number | string;
  outputDirectory?: string;
  promptFilter?: string;
  reportName?: string;
  skipScreenshots?: boolean;
  ragEndpoint?: string;
  labels?: string[];
  mcp: boolean;
  skipAiSummary?: boolean;
  skipAxeTesting?: boolean;
  enableUserJourneyTesting?: boolean;
  enableAutoCsp?: boolean;
  autoraterModel?: string;
  logging?: 'text-only' | 'dynamic';
}

function builder(argv: Argv): Argv<Options> {
  return argv
    .option('environment', {
      type: 'string',
      alias: ['env'],
      description: 'Path to the environment configuration file',
    })
    .option('model', {
      type: 'string',
      default: DEFAULT_MODEL_NAME,
      descript: 'Model to use when generating code',
    })
    .option('runner', {
      type: 'string',
      default: 'genkit',
      description: 'Runner to use to execute the eval',
    })
    .option('local', {
      type: 'boolean',
      default: false,
      description:
        'Whether to run the evaluation against locally-cached LLM output',
    })
    .option('limit', {
      type: 'number',
      default: 5,
      description: 'Maximum number of apps to generate and assess',
    })
    .option('concurrency', {
      type: 'string',
      default: 'auto',
      coerce: (v) => (v === 'auto' ? 'auto' : Number(v)),
      description: 'Maximum number of evaluations to run concurrently',
    })
    .option('output-directory', {
      type: 'string',
      alias: ['output-dir'],
      description:
        'Directory in which to output the generated code for debugging',
    })
    .option('prompt-filter', {
      type: 'string',
      description:
        'String used to filter which prompts from the current environment are being executed',
    })
    .option('report-name', {
      type: 'string',
      default: new Date().toISOString().replace(/[:.]/g, '-'),
      description: 'File name for the generated report',
    })
    .option('skip-screenshots', {
      type: 'boolean',
      default: false,
      description: 'Whether to skip screenshots of the generated app',
    })
    .option('rag-endpoint', {
      type: 'string',
      default: '',
      description: 'RAG endpoint to use to augment prompts',
    })
    .option('labels', {
      type: 'string',
      array: true,
      default: [],
      description: 'Metadata labels that will be attached to the run',
    })
    .option('logging', {
      type: 'string',
      default:
        process.env['CI'] === '1'
          ? ('text-only' as const)
          : ('dynamic' as const),
      defaultDescription: '`dynamic` (or `text-only` when `CI=1`)',
      requiresArg: true,
      choices: ['text-only', 'dynamic'] as const,
      description: 'Type of logging to use during the evaluation process',
    })
    .option('mcp', {
      type: 'boolean',
      default: false,
      description: 'Whether to start an MCP for the evaluation',
    })
    .option('skip-ai-summary', {
      type: 'boolean',
      default: false,
      description: 'Whether to skip generating an AI summary for the report',
    })
    .option('skip-axe-testing', {
      type: 'boolean',
      default: false,
      description: 'Whether to skip Axe testing of the generated app',
    })
    .option('enable-user-journey-testing', {
      type: 'boolean',
      default: false,
      alias: ['user-journeys'],
      description:
        'Whether to enable user journey testing through browser automation',
    })
    .option('enable-auto-csp', {
      type: 'boolean',
      default: false,
      description:
        'Whether to include a automatic hash-based Content-Security-Policy and Trusted Types to find incompatibilities.',
    })
    .option('autorater-model', {
      type: 'string',
      default: DEFAULT_AUTORATER_MODEL_NAME,
      description: 'Model to use when automatically rating generated code',
    })
    .strict()
    .version(false)
    .help()
    .showHelpOnFail(false);
}

async function handler(cliArgs: Arguments<Options>): Promise<void> {
  let llm: LlmRunner | null = null;
  let ratingLlm: GenkitRunner | null = null;

  if (!cliArgs.environment) {
    console.error(
      chalk.red(
        [
          '`--env` flag has not been specified. You have the following options:',
          ' - Pass a path to an environment config file using the `--env` flag.',
          ' - Pass `--env=angular-example` or `--env=solid-example` to use one of our built-in example environments.',
          ' - Pass `--help` to see all available options.',
        ].join('\n')
      )
    );
    process.exit(0);
  }

  try {
    llm = await getRunnerByName(cliArgs.runner as RunnerName);
    ratingLlm = await getRunnerByName('genkit');
    assertValidModelName(cliArgs.model, llm.getSupportedModels());
    const runInfo = await generateCodeAndAssess({
      llm,
      ratingLlm,
      model: cliArgs.model,
      environmentConfigPath:
        BUILT_IN_ENVIRONMENTS.get(cliArgs.environment) || cliArgs.environment,
      localMode: cliArgs.local,
      limit: cliArgs.limit,
      concurrency: cliArgs.concurrency as number,
      reportName: cliArgs.reportName!,
      skipScreenshots: !!cliArgs.skipScreenshots,
      startMcp: cliArgs.mcp,
      ragEndpoint: cliArgs.ragEndpoint,
      outputDirectory: cliArgs.outputDirectory,
      promptFilter: cliArgs.promptFilter,
      labels: cliArgs.labels || [],
      skipAxeTesting: !!cliArgs.skipAxeTesting,
      enableUserJourneyTesting: cliArgs.enableUserJourneyTesting,
      enableAutoCsp: cliArgs.enableAutoCsp,
      logging: cliArgs.logging,
      autoraterModel: cliArgs.autoraterModel,
    });

    logReportToConsole(runInfo);
    await writeReportToDisk(runInfo, runInfo.details.summary.environmentId);
  } catch (error) {
    if (error instanceof UserFacingError) {
      console.error(chalk.red(error.message));
    } else {
      console.error(
        chalk.red('An error occurred during the assessment process:')
      );
      console.error(chalk.red(error));
    }
  } finally {
    if (llm) {
      await llm.dispose();
    }

    if (ratingLlm) {
      await ratingLlm.dispose();
    }
  }
}
