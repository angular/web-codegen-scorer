import { ProgressType } from '../../progress/progress-logger.js';
import { AgentOutput } from '../../testing/browser-agent/models.js';
import { callWithTimeout } from '../../utils/timeout.js';
import { CspViolation } from '../serve-testing/auto-csp-types.js';
import { runBrowserAgentUserJourneyTests } from '../serve-testing/browser-agent.js';
import { runAppInPuppeteer } from '../serve-testing/puppeteer.js';
import {
  ServeTestingProgressLogMessage,
  ServeTestingResult,
  ServeTestingWorkerMessage,
  ServeTestingWorkerResponseMessage,
} from './worker-types.js';

process.on('message', async (message: ServeTestingWorkerMessage) => {
  const {
    appName,
    serveUrl,
    collectRuntimeErrors,
    enableAutoCsp,
    includeAxeTesting,
    takeScreenshots,
    userJourneyAgentTaskInput,
  } = message;
  const runtimeErrors: string[] = [];
  const progressLog = (
    state: ProgressType,
    message: string,
    details?: string
  ) => {
    process.send!({
      type: 'log',
      payload: { state, message, details },
    } satisfies ServeTestingProgressLogMessage);
  };

  let result: ServeTestingResult;
  let screenshotBase64Data: string | undefined = undefined;
  let axeViolations: any[] | undefined = [];
  let userJourneyAgentOutput: AgentOutput | null = null;
  let cspViolations: CspViolation[] | undefined = [];

  try {
    const puppeteerResult = await callWithTimeout(
      `Running ${appName} in Puppeteer`,
      () =>
        runAppInPuppeteer(
          appName,
          serveUrl,
          !!takeScreenshots,
          !!includeAxeTesting,
          progressLog,
          !!enableAutoCsp
        ),
      4 // 4min
    );

    screenshotBase64Data = puppeteerResult.screenshotBase64Data;
    axeViolations = puppeteerResult.axeViolations;
    cspViolations = puppeteerResult.cspViolations;
    if (collectRuntimeErrors) {
      runtimeErrors.push(...puppeteerResult.runtimeErrors);
    }

    if (userJourneyAgentTaskInput) {
      userJourneyAgentOutput = await runBrowserAgentUserJourneyTests(
        appName,
        serveUrl,
        userJourneyAgentTaskInput,
        progressLog
      );
    }

    result = {
      screenshotPngUrl: screenshotBase64Data
        ? `data:image/png;base64,${screenshotBase64Data}`
        : undefined,
      runtimeErrors: runtimeErrors.join('\n'),
      axeViolations,
      userJourneyAgentOutput: userJourneyAgentOutput,
      cspViolations,
    };
  } catch (error: any) {
    const cleanErrorMessage = cleanupBuildMessage(error.message);
    result = {
      errorMessage: cleanErrorMessage,
      runtimeErrors: runtimeErrors.join('\n'),
      userJourneyAgentOutput: userJourneyAgentOutput,
      cspViolations,
    };
  }

  process.send!({
    type: 'result',
    payload: result,
  } satisfies ServeTestingWorkerResponseMessage);
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
