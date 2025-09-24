import { ChildProcess, exec } from 'child_process';
import { killChildProcessGracefully } from '../../utils/kill-gracefully.js';
import { cleanupBuildMessage } from '../builder/worker.js';
import { ProgressLogger } from '../../progress/progress-logger.js';
import { RootPromptDefinition } from '../../shared-interfaces.js';

export async function serveApp<T>(
  serveCommand: string,
  rootPromptDef: RootPromptDefinition,
  appDirectoryPath: string,
  progress: ProgressLogger,
  logicWhileServing: (serveUrl: string) => Promise<T>
): Promise<T> {
  let serveProcess: ChildProcess | null = null;

  try {
    serveProcess = exec(serveCommand, { cwd: appDirectoryPath });
    progress.log(
      rootPromptDef,
      'eval',
      'Launching app inside a browser',
      `(PID: ${serveProcess.pid})`
    );

    const actualPort = await new Promise<number>((resolvePort, rejectPort) => {
      const serveStartTimeout = 45000; // 45s for serve to start
      const timeoutId = setTimeout(() => {
        rejectPort(
          new Error(
            `Serving process for \`${rootPromptDef.name}\` timed out waiting for port information after ${serveStartTimeout / 1000}s.`
          )
        );
      }, serveStartTimeout);

      let outputBuffer = '';
      let portResolved = false;
      const portRegex = /(?:localhost|127\.0\.0\.1):(\d+)/;

      const processOutput = (chunk: Buffer | string) => {
        // Formatting can throw off the regex above so we strip it out.
        const dataStr = cleanupBuildMessage(chunk.toString());
        outputBuffer += dataStr;

        if (!portResolved) {
          const match = outputBuffer.match(portRegex);

          if (match && match[1]) {
            clearTimeout(timeoutId);
            const port = parseInt(match[1], 10);
            progress.log(
              rootPromptDef,
              'eval',
              `App is up and running on port ${port}`
            );
            portResolved = true;
            resolvePort(port);
          }
        }
      };

      serveProcess!.stdout?.on('data', (data) => processOutput(data));
      serveProcess!.stderr?.on('data', (data) => processOutput(data));

      serveProcess!.on('error', (err) => {
        clearTimeout(timeoutId);
        progress.log(rootPromptDef, 'error', 'Failed to launch app', err + '');
        rejectPort(err);
      });

      serveProcess!.on('exit', (code, signal) => {
        clearTimeout(timeoutId);
        // This listener might be called after port is resolved and process is killed by us.
        // Only reject if it exits prematurely *before* port resolution.
        // The promise infrastructure prevents multiple resolves/rejects.
        if (code !== 0 && code !== null) {
          rejectPort(
            new Error(
              `Launch process for \`${rootPromptDef.name}\` exited prematurely with code ${code}, signal ${signal}. Output: ${outputBuffer.slice(-500)}`
            )
          );
        } else if (
          code === null &&
          signal &&
          signal !== 'SIGTERM' &&
          signal !== 'SIGINT'
        ) {
          // SIGTERM/SIGINT is expected for our kill
          rejectPort(
            new Error(
              `Launch process for \`${rootPromptDef.name}\` was killed by unexpected signal ${signal} before port resolution. Output: ${outputBuffer.slice(-500)}`
            )
          );
        }
      });
    });

    const hostUrl = `http://localhost:${actualPort}`;

    return await logicWhileServing(hostUrl);
  } finally {
    if (serveProcess) {
      progress.log(
        rootPromptDef,
        'eval',
        'Terminating browser process for app',
        `(PID: ${serveProcess.pid})`
      );
      await killChildProcessGracefully(serveProcess);
      serveProcess = null;
    }
  }
}
