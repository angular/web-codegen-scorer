import {Arguments, Argv, CommandModule} from 'yargs';
import chalk from 'chalk';
import {
  BUILT_IN_ENVIRONMENTS,
  DEFAULT_AUTORATER_MODEL_NAME,
  DEFAULT_MAX_BUILD_REPAIR_ATTEMPTS,
  DEFAULT_MAX_TEST_REPAIR_ATTEMPTS,
  DEFAULT_MODEL_NAME,
  DEFAULT_PROMPT_TIMEOUT_RETRIES,
  REPORTS_ROOT_DIR,
} from './configuration/constants.js';
import {generateCodeAndAssess} from './orchestration/generate.js';
import {logReportToConsole, writeReportToDisk} from './reporting/report-logging.js';
import {RunnerName} from './codegen/runner-creation.js';
import {UserFacingError} from './utils/errors.js';

export const EvalModule = {
  builder,
  handler,
  command: 'eval',
  describe: 'Evaluate code using an LLM',
} satisfies CommandModule<{}, Options>;

interface Options {
  environment?: string;
  model: string;
  runner: RunnerName;
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
  skipLighthouse?: boolean;
  maxTestRepairAttempts?: number;
  maxBuildRepairAttempts?: number;
  promptTimeoutRetries?: number;
}

function builder(argv: Argv): Argv<Options> {
  return (
    argv
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
      // Option is a noop right now when using a remote environment.
      .option('runner', {
        type: 'string',
        default: 'ai-sdk' as const,
        choices: ['ai-sdk', 'gemini-cli', 'claude-code', 'codex'] as RunnerName[],
        description: 'Runner to use to execute the eval',
      })
      .option('local', {
        type: 'boolean',
        default: false,
        description: 'Whether to run the evaluation against locally-cached LLM output',
      })
      .option('limit', {
        type: 'number',
        default: 5,
        description: 'Maximum number of apps to generate and assess',
      })
      .option('concurrency', {
        type: 'string',
        default: 'auto',
        coerce: v => (v === 'auto' ? 'auto' : Number(v)),
        description: 'Maximum number of evaluations to run concurrently',
      })
      .option('output-directory', {
        type: 'string',
        alias: ['output-dir'],
        description: 'Directory in which to output the generated code for debugging',
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
        default: process.env['CI'] === '1' ? ('text-only' as const) : ('dynamic' as const),
        defaultDescription: '`dynamic` (or `text-only` when `CI=1`)',
        requiresArg: true,
        choices: ['text-only', 'dynamic'] as const,
        description: 'Type of logging to use during the evaluation process',
      })
      // Option is a noop right now when using a remote environment.
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
        description: 'Whether to enable user journey testing through browser automation',
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
      .option('skip-lighthouse', {
        type: 'boolean',
        default: false,
        description: 'Whether to skip collecting Lighthouse data',
      })
      .option('max-build-repair-attempts', {
        type: 'number',
        default: DEFAULT_MAX_BUILD_REPAIR_ATTEMPTS,
        description: 'Number of repair attempts when build errors are discovered',
      })
      .option('max-test-repair-attempts', {
        type: 'number',
        default: DEFAULT_MAX_TEST_REPAIR_ATTEMPTS,
        description:
          'Number of repair attempts for discovered test failures (including a11y violations and ones from testCommand)',
      })
      .option('prompt-timeout-retries', {
        type: 'number',
        default: DEFAULT_PROMPT_TIMEOUT_RETRIES,
        description:
          'Maximum number of times to retry a prompt evaluation after it fails due to a timeout.',
      })
      .strict()
      .version(false)
      .help()
      .showHelpOnFail(false)
  );
}

async function handler(cliArgs: Arguments<Options>): Promise<void> {
  if (!cliArgs.environment) {
    console.error(
      chalk.red(
        [
          '`--env` flag has not been specified. You have the following options:',
          ' - Pass a path to an environment config file using the `--env` flag.',
          ' - Pass `--env=angular-example` or `--env=solid-example` to use one of our built-in example environments.',
          ' - Pass `--help` to see all available options.',
        ].join('\n'),
      ),
    );
    process.exit(0);
  }

  const abortCtrl = new AbortController();

  process.on('SIGINT', () => abortCtrl.abort());
  process.on('SIGTERM', () => abortCtrl.abort());
  process.on('SIGTERM', () => abortCtrl.abort());
  process.on('exit', () => abortCtrl.abort());

  try {
    const runInfo = await generateCodeAndAssess({
      runner: cliArgs.runner,
      model: cliArgs.model,
      environment: {
        configPath: BUILT_IN_ENVIRONMENTS.get(cliArgs.environment) || cliArgs.environment,
      },
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
      skipAiSummary: cliArgs.skipAiSummary,
      skipLighthouse: cliArgs.skipLighthouse,
      maxBuildRepairAttempts: cliArgs.maxBuildRepairAttempts,
      maxTestRepairAttempts: cliArgs.maxTestRepairAttempts,
      promptTimeoutRetries: cliArgs.promptTimeoutRetries,
      abortSignal: abortCtrl.signal,
    });

    logReportToConsole(runInfo);
    await writeReportToDisk(runInfo, runInfo.details.summary.environmentId, REPORTS_ROOT_DIR);
  } catch (error: unknown) {
    if (error instanceof UserFacingError) {
      console.error(chalk.red(error.message));
    } else {
      console.error(chalk.red('An error occurred during the assessment process:'));
      console.error(chalk.red(error));
      if (process.env.DEBUG === '1' && (error as Partial<Error>).stack) {
        console.error(chalk.red((error as Error).stack));
      }
    }
  }
}
