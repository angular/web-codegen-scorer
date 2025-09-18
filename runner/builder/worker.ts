import { delimiter, join } from 'path';
import {
  BuildWorkerMessage,
  BuildResult,
  BuildResultStatus,
  BuildErrorType,
  BuildWorkerResponseMessage,
} from './builder-types.js';
import { CspViolation } from './auto-csp-types.js';
import { runAppInPuppeteer } from './puppeteer.js';
import { redX } from '../reporting/format.js';
import { callWithTimeout } from '../utils/timeout.js';
import { serveApp } from './serve-app.js';
import { runBrowserAgentUserJourneyTests } from './browser-agent.js';
import { AgentOutput } from '../testing/browser-agent/models.js';
import { executeCommand } from '../utils/exec.js';
import { ProgressType } from '../progress/progress-logger.js';

import { PackageSummary } from '@safety-web/types';
import { run as runSafetyWeb } from '@safety-web/runner';

process.on('message', async (message: BuildWorkerMessage) => {
  const {
    appName,
    directory,
    buildCommand,
    serveCommand,
    collectRuntimeErrors,
    takeScreenshots,
    includeAxeTesting,
    userJourneyAgentTaskInput,
    enableAutoCsp,
  } = message;
  let result: BuildResult;
  const runtimeErrors: string[] = [];
  const progressLog = (
    state: ProgressType,
    message: string,
    details?: string
  ) => {
    process.send!({
      type: 'log',
      payload: { state, message, details },
    } satisfies BuildWorkerResponseMessage);
  };

  try {
    // Run the build command inside the temporary project directory
    await callWithTimeout(
      `Building ${appName}`,
      (abortSignal) =>
        executeCommand(
          buildCommand,
          directory,
          {
            PATH: `${process.env.PATH}${delimiter}${join(directory, 'node_modules/.bin')}`,
          },
          { abortSignal }
        ),
      4 // 4min. This is a safety boundary. Lots of parallelism can slow-down.
    );
  } catch (error: any) {
    const cleanErrorMessage = cleanupBuildMessage(error.message);
    const errorType = classifyBuildError(cleanErrorMessage);

    process.send!({
      type: 'build',
      payload: {
        status: BuildResultStatus.ERROR,
        message: cleanErrorMessage,
        errorType,
        missingDependency:
          errorType === BuildErrorType.MISSING_DEPENDENCY
            ? extractMissingDependency(cleanErrorMessage)
            : undefined,
        userJourneyAgentOutput: null,
      },
    } satisfies BuildWorkerResponseMessage);
    return;
  }

  let safetyWebReportJson: PackageSummary[] | undefined;
  try {
    // Run the safety-web runner on the temporary project directory
    const safetyWebSummaries = await callWithTimeout(
      `SAFETY WEB ${appName}`,
      (_abortSignal) =>
        runSafetyWeb(
          directory,
          /* processPrivatePackages */ true,
          /* useDefaultTSConfig */ true
        ),
      4
    );
    safetyWebReportJson = new Array(...safetyWebSummaries);
  } catch (error: any) {
    console.error(
      `${redX()} Could not create safety web report for \`${appName}\``,
      error
    );
  }

  const needsToServeApp =
    collectRuntimeErrors ||
    takeScreenshots ||
    includeAxeTesting ||
    userJourneyAgentTaskInput !== undefined;

  // If build is successful, try to serve and app and take a screenshot if requested
  let screenshotBase64Data: string | undefined = undefined;
  let axeViolations: any[] | undefined = [];
  let userJourneyAgentOutput: AgentOutput | null = null;
  let cspViolations: CspViolation[] | undefined = [];

  try {
    if (needsToServeApp) {
      await serveApp(
        serveCommand,
        appName,
        directory,
        progressLog,
        async (hostUrl) => {
          const result = await callWithTimeout(
            `Running ${appName} in Puppeteer`,
            () =>
              runAppInPuppeteer(
                appName,
                hostUrl,
                directory,
                !!takeScreenshots,
                !!includeAxeTesting,
                progressLog,
                !!enableAutoCsp
              ),
            4 // 4min
          );

          screenshotBase64Data = result.screenshotBase64Data;
          axeViolations = result.axeViolations;
          cspViolations = result.cspViolations;
          if (collectRuntimeErrors) {
            runtimeErrors.push(...result.runtimeErrors);
          }

          if (userJourneyAgentTaskInput) {
            userJourneyAgentOutput = await runBrowserAgentUserJourneyTests(
              appName,
              hostUrl,
              userJourneyAgentTaskInput,
              progressLog
            );
          }
        }
      );
    }
    result = {
      status: BuildResultStatus.SUCCESS,
      message: 'Application built successfully!',
      screenshotPngUrl: `data:image/png;base64,${screenshotBase64Data}`,
      runtimeErrors: runtimeErrors.join('\n'),
      axeViolations,
      safetyWebReportJson,
      userJourneyAgentOutput: userJourneyAgentOutput,
      cspViolations,
    };
  } catch (error: any) {
    const cleanErrorMessage = cleanupBuildMessage(error.message);
    const errorType = classifyBuildError(cleanErrorMessage);

    // TODO: Improve general error handling here. Split up build result with serve result.
    result = {
      status: BuildResultStatus.ERROR,
      message: cleanErrorMessage,
      errorType: errorType,
      runtimeErrors: runtimeErrors.join('\n'),
      safetyWebReportJson,
      userJourneyAgentOutput: userJourneyAgentOutput,
      cspViolations,
    };
  }

  process.send!({
    type: 'build',
    payload: result,
  } satisfies BuildWorkerResponseMessage);
});

/**
 * Removes ANSI escape codes from a string.
 *
 * @param text The input string, potentially containing ANSI escape codes.
 * @returns The string with ANSI escape codes removed.
 */
export function cleanupBuildMessage(text: string): string {
  // Remove ANSI escape codes
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Classifies a build error message into a predefined category.
 *
 * This function inspects the error message string for specific patterns
 * to determine if it's a known type of error like a missing dependency,
 * Angular diagnostic, or TypeScript error.
 *
 * @param errorMessage The raw error message string from the build process.
 * @returns The classified `BuildErrorType`.
 */
function classifyBuildError(errorMessage: string): BuildErrorType {
  if (
    errorMessage.includes('Could not resolve') ||
    errorMessage.includes('Cannot find module') ||
    errorMessage.includes("Can't resolve")
  ) {
    return BuildErrorType.MISSING_DEPENDENCY;
  }
  if (/\[ERROR\]\s*NG\d+/.test(errorMessage)) {
    return BuildErrorType.ANGULAR_DIAGNOSTIC;
  }
  if (
    /\[ERROR\]\s*TS\d+/.test(errorMessage) ||
    errorMessage.includes('Type error')
  ) {
    return BuildErrorType.TYPESCRIPT_ERROR;
  }
  return BuildErrorType.OTHER;
}

/**
 * Extracts the name of a missing dependency from a build error message.
 */
function extractMissingDependency(buildError: string): string | undefined {
  const patterns = [
    /Could not resolve "([^"]+)"/,
    /Could not resolve '([^']+)'/,
    /Cannot find module "([^"]+)"/,
    /Cannot find module '([^']+)'/,
    /Can't resolve "([^"]+)"/,
    /Can't resolve '([^']+)'/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(buildError);
    if (match && match[1]) return match[1];
  }
  return undefined;
}
