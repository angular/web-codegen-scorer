import { ChildProcess } from 'child_process';
import treeKill from 'tree-kill';

function treeKillPromise(pid: number, signal: string): Promise<void> {
  return new Promise((resolve, reject) => {
    treeKill(pid, signal, (err) => {
      if (err !== undefined) {
        reject(err);
      } else {
        resolve(err);
      }
    });
  });
}

export function killChildProcessGracefully(
  child: ChildProcess,
  timeoutInMs = 1000 * 10 // 10s
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    // Process already exited.
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    const pid = child.pid;
    if (pid === undefined) {
      throw new Error(`No process ID for processed that should be killed.`);
    }

    // Watch for exiting, so that we can cancel the timeout(s) then.
    child.on('exit', () => {
      clearTimeout(sigkillTimeoutId);
      clearTimeout(rejectTimeoutId);
      resolve();
    });

    // Send SIGTERM
    try {
      await treeKillPromise(pid, 'SIGTERM');
    } catch (e) {
      console.error(
        `Could not send "SIGTERM" for killing process. Trying "SIGKILL".`
      );
    }

    // Start a timeout for the SIGKILL fallback
    const sigkillTimeoutId = setTimeout(
      () => treeKill(pid, 'SIGKILL'),
      timeoutInMs
    );
    // Start another timeout to reject the promise if the child process never fires `exit` for some reasons.
    const rejectTimeoutId = setTimeout(
      () =>
        reject(
          new Error('Child process did not exit gracefully within the timeout.')
        ),
      timeoutInMs * 2
    );
  });
}
