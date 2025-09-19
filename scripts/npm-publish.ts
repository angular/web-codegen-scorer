import { join } from 'path';
import { spawn } from 'child_process';
import { input } from '@inquirer/prompts';
import { executeCommand } from '../runner/utils/exec.js';
import { readFile, writeFile } from 'fs/promises';

const root = join(import.meta.dirname, '..');
const distDirectory = join(root, 'dist');
const packageJsonPath = join(root, 'package.json');
const registry = 'https://wombat-dressing-room.appspot.com';

(async () => {
  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
      version: string;
    };

    const version = await input({
      message: `Which version would you like to publish? Current version is ${packageJson.version}`,
      required: true,
    });

    // Build the project.
    await executeCommand(
      `pnpm release-build --version=${version}`,
      root,
      undefined,
      {
        forwardStdoutToParent: true,
        forwardStderrToParent: true,
      }
    );

    // Log into our registry.
    await spawnInteractive('npm', ['login', '--registry', registry]);

    // Publish to npm.
    await executeCommand(
      `npm --registry ${registry} publish --access public --tag latest`,
      distDirectory,
      undefined,
      {
        forwardStderrToParent: true,
        forwardStdoutToParent: true,
      }
    );

    // Write the package.json back to disk so the version is in sync.
    packageJson.version = version;
    await writeFile(packageJsonPath, JSON.stringify(packageJson, undefined, 2));

    console.log('Done! 🎉');
    console.log('Remember to push the changed package.json!');
  } catch (e: unknown) {
    // If the user presses ctrl + c, Inquirer will throw `ExitPromptError`. Ignore it.
    if (!(e instanceof Error) || e.name !== 'ExitPromptError') {
      throw e;
    }
  }
})();

function spawnInteractive(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const childProcess = spawn(command, args, {
      shell: true,
      stdio: 'inherit',
    });

    childProcess.on('close', (status) =>
      status === 0 ? resolve() : reject(status)
    );
  });
}
