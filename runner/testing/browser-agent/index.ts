import {spawn} from 'child_process';
import {executeCommand} from '../../utils/exec.js';
import {UserFacingError} from '../../utils/errors.js';

let pendingDepInstall: Promise<void> | null = null;

export async function runPythonAgentScript(
  taskFile: string,
  hostUrl: string,
  abortSignal: AbortSignal,
  opts?: {printLogOutput?: boolean},
): Promise<string> {
  const processDir = import.meta.dirname;

  // Install the Python dependencies necessary for the run. Note that we reuse the same
  // promise, because parallel runs might be trying to install in the same directory.
  if (!pendingDepInstall) {
    pendingDepInstall = installPythonDependencies(processDir);
  }

  await pendingDepInstall;

  // Run the browser-use Python script with fd3 for agent output.
  // All other descriptors are easily polluted, so we use a separate one.
  const child = spawn('uv', ['run', 'main.py', '--task', taskFile], {
    cwd: processDir,
    stdio: [
      'pipe', // stdin
      'pipe', // stdout
      'pipe', // stderr
      'pipe', // fd3 - for agent output
    ],
    signal: abortSignal,
    env: {
      EVAL_TOOL_APP_URL: hostUrl,
      ...process.env,
    },
  });

  const output: Buffer[] = [];
  child.stdio[3]!.on('data', data => {
    output.push(data);
  });

  child.stdout!.on('data', data => {
    if (opts?.printLogOutput) {
      process.stderr.write(data);
    }
  });

  const stderrOutput: Buffer[] = [];
  child.stderr!.on('data', data => {
    if (opts?.printLogOutput) {
      process.stderr.write(data);
    }
    stderrOutput.push(data);
  });

  return await new Promise<string>((resolve, reject) => {
    child.on('close', code => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrOutput).toString('utf8');
        reject(new Error(`Process exited with code ${code}.\n\nStderr:\n${stderr}`));
        return;
      }
      const outputFd3 = Buffer.concat(output).toString('utf8');
      resolve(outputFd3);
    });
    child.on('error', err => {
      reject(`Error when spawning: ${err}`);
    });
  });
}

async function installPythonDependencies(processDir: string): Promise<void> {
  try {
    await executeCommand('uv pip install browser-use', processDir);
    await executeCommand('uvx playwright install chromium --with-deps', processDir);
  } catch (e) {
    throw new UserFacingError(
      `Failed to install user journey agent dependencies in ${processDir}\n` + e,
    );
  }
}
