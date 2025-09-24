import { delimiter, join } from 'path';
import { redX } from '../../reporting/format.js';
import { executeCommand } from '../../utils/exec.js';
import { callWithTimeout } from '../../utils/timeout.js';
import {
  BuildErrorType,
  BuildResultStatus,
  BuildWorkerMessage,
  BuildWorkerResponseMessage,
} from './builder-types.js';

import { run as runSafetyWeb } from '@safety-web/runner';
import { PackageSummary } from '@safety-web/types';

process.on('message', async (message: BuildWorkerMessage) => {
  const { appName, directory, buildCommand } = message;

  try {
    // Run the build command inside the temporary project directory
    await callWithTimeout(
      `Building ${appName}`,
      (abortSignal) =>
        executeCommand(
          buildCommand,
          directory,
          {
            PATH: `${process.env['PATH']}${delimiter}${join(directory, 'node_modules/.bin')}`,
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

  process.send!({
    type: 'build',
    payload: {
      status: BuildResultStatus.SUCCESS,
      message: 'Application built successfully!',
      safetyWebReportJson,
    },
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
