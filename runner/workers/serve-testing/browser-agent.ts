import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { runPythonAgentScript } from '../../testing/browser-agent/index.js';
import {
  AgentOutput,
  BrowserAgentTaskInput,
} from '../../testing/browser-agent/models.js';
import { callWithTimeout } from '../../utils/timeout.js';
import { binaryExists } from '../../utils/binary-exists.js';
import { UserFacingError } from '../../utils/errors.js';
import { ServeTestingProgressLogFn } from './worker-types.js';

export async function runBrowserAgentUserJourneyTests(
  appName: string,
  hostUrl: string,
  agentTask: BrowserAgentTaskInput,
  progressLog: ServeTestingProgressLogFn
): Promise<AgentOutput | null> {
  const tmpDir = await mkdtemp(
    join(tmpdir(), 'browser-agent-user-journey-task-')
  );
  const taskJsonFile = join(tmpDir, 'task.json');
  await writeFile(taskJsonFile, JSON.stringify(agentTask));

  const [hasPython, hasUv] = await Promise.all([
    binaryExists('python3'),
    binaryExists('uv'),
  ]);
  const docsLink = 'https://docs.browser-use.com/quickstart';
  progressLog('eval', 'Starting User Journey testing');

  if (!hasPython) {
    throw new UserFacingError(
      `Cannot run user journey testing, because Python is not installed. See ${docsLink}.`
    );
  }

  if (!hasUv) {
    throw new UserFacingError(
      `Cannot run user journey testing, because \`uv\` is not installed. See ${docsLink}.`
    );
  }

  try {
    const startTime = performance.now();

    const resultStdout = await callWithTimeout(
      `User journey testing for ${appName}`,
      (abortSignal) =>
        runPythonAgentScript(taskJsonFile, hostUrl, abortSignal, {
          printLogOutput: false,
        }),
      4 // 4min
    );

    const deltaTime = Math.ceil((performance.now() - startTime) / 1000);
    progressLog('eval', 'Completed user journey testing', `(${deltaTime}s)`);
    return JSON.parse(resultStdout.trim()) as AgentOutput;
  } catch (e) {
    progressLog(
      'error',
      'Error while running user journey browser tests',
      e + ''
    );
    return null;
  }
}
