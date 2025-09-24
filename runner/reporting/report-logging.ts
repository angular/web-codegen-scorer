import { join } from 'path';
import chalk from 'chalk';
import boxen from 'boxen';
import {
  IndividualAssessmentState,
  RunInfo,
  ScoreBucket,
} from '../shared-interfaces.js';
import {
  DEFAULT_AUTORATER_MODEL_NAME,
  REPORTS_ROOT_DIR,
} from '../configuration/constants.js';
import { calculateBuildAndCheckStats } from '../ratings/stats.js';
import { safeWriteFile } from '../file-system-utils.js';
import { BuildResultStatus } from '../workers/builder/builder-types.js';
import {
  formatTokenCount,
  greenCheckmark,
  printJson,
  redX,
  formatAssessmentMessage,
  formatScore,
  formatTitleCard,
} from './format.js';
import { Environment } from '../configuration/environment.js';
import { LlmRunner } from '../codegen/llm-runner.js';
import { groupSimilarReports } from '../orchestration/grouping.js';
import { LocalEnvironment } from '../configuration/environment-local.js';

/**
 * Generates a structured report on fs, based on the assessment run information.
 *
 * The report is created in the reports directory. Each run gets its own subfolder,
 * named according to `runInfo.details.reportName`.
 *
 * Inside a run's folder:
 * - `summary.json`: Contains overall run details, including prompts used.
 * - A subfolder for each assessed prompt (named after `promptDef.name`).
 *   - Inside each prompt's subfolder:
 *     - `assessment.json`: Scores, build status, build messages, and repair attempts for this prompt.
 *     - A subfolder for each attempt (e.g., "0", "1").
 *       - Inside each attempt's subfolder:
 *         - `app.ts`: The generated code for that attempt.
 *         - `stats.json`: File size of the generated code.
 *         - `build.log`: (Only if the build failed) The error message from the build process.
 *
 * @param runInfo An object containing all details and results of the assessment run.
 * @param id ID of the environment that was used for the eval.
 * @returns The original `runInfo` object, allowing for chaining.
 */
export async function writeReportToDisk(
  runInfo: RunInfo,
  id: string
): Promise<void> {
  // Sanitize report name: allow only a-z, A-Z, 0-9, and hyphens. Replace others with a hyphen.
  const sanitizedReportName = runInfo.details.reportName.replace(
    /[^a-zA-Z0-9-]/g,
    '-'
  );

  const { results } = runInfo;
  const reportBaseDir = join(REPORTS_ROOT_DIR, id, sanitizedReportName);

  // Write `summary.json` file, which contains **all** available info.
  const summaryJsonPath = join(reportBaseDir, 'summary.json');
  await safeWriteFile(summaryJsonPath, printJson(runInfo));

  // Write a single group to disk containing only the current report.
  // It's up to the user if they want to use this groping info somehow.
  const groupInfo = groupSimilarReports([runInfo]);
  const groupJsonPath = join(reportBaseDir, 'groups.json');
  await safeWriteFile(groupJsonPath, printJson(groupInfo));

  // Output info for each prompt
  for (const result of results) {
    const promptPath = join(reportBaseDir, result.promptDef.name);

    const assessmentJson = result;
    const assessmentJsonPath = join(promptPath, 'assessment.json');
    await safeWriteFile(assessmentJsonPath, printJson(assessmentJson));

    for (const attempt of result.attemptDetails) {
      const attemptPath = join(promptPath, attempt.attempt.toString());

      // Write file with stats
      const statsJson = {
        fileSize: attempt.outputFiles.reduce(
          (total, current) => (total += current.code.length),
          0
        ),
        buildResult: attempt.buildResult,
        serveTestingResult: attempt.serveTestingResult,
      };
      const statsCodePath = join(attemptPath, 'stats.json');
      await safeWriteFile(statsCodePath, printJson(statsJson));

      await Promise.all(
        result.outputFiles.map((file) =>
          safeWriteFile(join(attemptPath, file.filePath), file.code)
        )
      );

      // Write build.log for failed builds
      if (attempt.buildResult.status === BuildResultStatus.ERROR) {
        await safeWriteFile(
          join(attemptPath, 'build.log'),
          attempt.buildResult.message
        );
      }

      // Write screenshot to fs first, since we'll remove this info
      // from JSON later in this function.
      if (attempt.serveTestingResult?.screenshotPngUrl) {
        const screenshotFilePath = join(attemptPath, 'screenshot.png');

        // Note: In practice this is a base64 data URL, but `fetch` conveniently
        // allows us to extract the content for writing a PNG to disk.
        const screenshotContent = await (
          await fetch(attempt.serveTestingResult.screenshotPngUrl)
        ).arrayBuffer();

        await safeWriteFile(screenshotFilePath, Buffer.from(screenshotContent));
      }

      // Write the safety web report if it exists.
      if (attempt.buildResult?.safetyWebReportJson) {
        const reportFilePath = join(attemptPath, 'safety-web.json');
        await safeWriteFile(
          reportFilePath,
          JSON.stringify(attempt.buildResult.safetyWebReportJson, null, 2)
        );
      }

      // Write the CSP violations if they exist.
      if (
        attempt.serveTestingResult?.cspViolations &&
        attempt.serveTestingResult.cspViolations.length > 0
      ) {
        const reportFilePath = join(attemptPath, 'csp-violations.json');
        await safeWriteFile(
          reportFilePath,
          JSON.stringify(attempt.serveTestingResult.cspViolations, null, 2)
        );
      }
    }
  }

  console.log(
    [
      '',
      `${greenCheckmark()} Full report has been saved to the '${reportBaseDir}' directory.`,
      '🚀 Run `web-codegen-scorer report` to view the report in your browser!',
      '',
    ].join('\n')
  );
}

/** Logs information about a report at the beginning of a run. */
export function logReportHeader(
  env: Environment,
  promptsToProcess: number,
  concurrency: number,
  options: {
    model: string;
    labels: string[];
    startMcp?: boolean;
    autoraterModel?: string;
  }
): void {
  const titleCardText = [
    'Running a codegen evaluation with configuration:',
    '',
    ` - Environment: ${env.displayName}`,
    ` - Model: ${options.model}`,
    options.autoraterModel &&
    options.autoraterModel !== DEFAULT_AUTORATER_MODEL_NAME
      ? ` - Autorater model: ${options.autoraterModel}`
      : null,
    ` - Runner: ${env instanceof LocalEnvironment ? env.llm.displayName : 'Remote'}`,
    env instanceof LocalEnvironment
      ? ` - MCP servers: ${options.startMcp && env.mcpServerOptions.length ? env.mcpServerOptions.length : 'none'}`
      : null,
    options.labels.length ? ` - Labels: ${options.labels.join(', ')}` : null,
    ` - Concurrency: ${concurrency}`,
    ` - Framework: ${env.clientSideFramework.displayName}`,
    ` - Start time: ${new Date().toLocaleString()}`,
    ` - Number of prompts: ${promptsToProcess}`,
  ]
    .filter((line) => line != null)
    .join('\n');

  console.log(formatTitleCard(titleCardText));
}

export function logReportToConsole(runInfo: RunInfo): void {
  const { details, results } = runInfo;
  const { builds, buckets } = calculateBuildAndCheckStats(results);
  const { usage } = details.summary;
  const { successfulInitialBuilds, successfulBuildsAfterRepair } = builds;
  const totalResults = results.length || 1; // Avoid division by zero if results is empty

  results.forEach((result, index) => {
    console.log(` Prompt #${index}: ${chalk.bold(result.promptDef.name)}`);
    console.log(` Text: ${result.promptDef.prompt}`);

    const { maxOverallPoints, totalPoints } = result.score;
    const scorePercentage = (totalPoints / maxOverallPoints) * 100;

    const scoreMessage = `${Math.round(totalPoints)} / ${maxOverallPoints} points (${scorePercentage.toFixed(2)}%)`;
    console.log(
      ` Code Quality Score: ${formatScore(totalPoints / maxOverallPoints, scoreMessage)}`
    );

    console.log(' Scoring Details');
    result.score.categories.forEach((category) => {
      console.log(
        `  ${category.name} (${category.points}/${category.maxPoints} points):`
      );

      if (category.assessments.length === 0) {
        console.log('   No assessments');
      }

      category.assessments.forEach((assessment) => {
        let statusIcon: string;
        if (assessment.state === IndividualAssessmentState.SKIPPED) {
          statusIcon = '-';
        } else {
          statusIcon =
            assessment.successPercentage === 1
              ? `${greenCheckmark()}`
              : `${redX()}`;
        }

        const potentialMultilineAssessmentMessage =
          assessment.message.replaceAll('\n', '\n       ');

        const formattedMessage = formatAssessmentMessage(
          assessment,
          potentialMultilineAssessmentMessage
        );

        console.log(`   ${statusIcon} ${assessment.name}: ${formattedMessage}`);
      });
    });

    // Do not show the separator after the last item.
    if (index < results.length - 1) {
      console.log('\n ' + '─'.repeat(80));
    }
  });

  const failedBuilds =
    results.length - successfulInitialBuilds - successfulBuildsAfterRepair;

  const summaryLines = [
    'Run info:',
    ` - Environment: ${runInfo.details.summary.displayName}`,
    ` - Model: ${runInfo.details.summary.model}`,
    ` - Runner: ${runInfo.details.summary.runner?.displayName}`,
    runInfo.details.labels?.length
      ? ` - Labels: ${runInfo.details.labels.join(', ')}`
      : null,
    ` - Framework: ${runInfo.details.summary.framework.clientSideFramework.displayName}`,
    ` - End time: ${new Date().toLocaleString()}`,
    ` - Total prompts processed: ${results.length}`,
    '',
    `Build stats:`,
    formatSummaryLine(
      'Successful initial builds',
      successfulInitialBuilds,
      totalResults,
      chalk.green
    ),
    formatSummaryLine(
      'Successful builds after repair',
      successfulBuildsAfterRepair,
      totalResults,
      chalk.yellow
    ),
    formatSummaryLine('Failed builds', failedBuilds, totalResults, chalk.red),
    '',
    'Code quality stats:',
    ...buckets.map((bucket) =>
      formatSummaryLine(
        bucket.nameWithLabels,
        bucket.appsCount,
        totalResults,
        bucketToChalkFn(bucket)
      )
    ),
    '',
    'Usage info:',
    ` - Input tokens: ${formatTokenCount(usage.inputTokens)}`,
    ` - Output tokens: ${formatTokenCount(usage.outputTokens)}`,
    ` - Total tokens: ${formatTokenCount(usage.totalTokens)}`,
  ].filter((line) => line != null);

  console.log(
    boxen(summaryLines.join('\n'), {
      padding: 1,
      margin: { top: 2 },
      width: Math.min(80, process.stdout.columns),
      borderColor: 'cyan',
      borderStyle: 'double',
      title: 'Assessment Summary',
      titleAlignment: 'center',
    })
  );
}

/**
 * Formats a summary line with a count, percentage, and color.
 *
 * @param label The text label for the summary line.
 * @param count The specific count for this item.
 * @param total The total number of items for percentage calculation.
 * @param colorFn Function used to apply color to the message.
 */
function formatSummaryLine(
  label: string,
  count: number,
  total: number,
  colorFn: (value: string) => string
): string {
  const percentage = total > 0 ? (count / total) * 100 : 0;
  return ` - ${label}: ${colorFn(`${count} (${percentage.toFixed(1)}%)`)}`;
}

/**
 * Determines which Chalk function can be used to log out a specific color.
 */
function bucketToChalkFn(bucket: ScoreBucket): (value: string) => string {
  if (bucket.min >= 85) {
    return chalk.green;
  } else if (bucket.min >= 71) {
    return chalk.yellow;
  }

  return chalk.red;
}
