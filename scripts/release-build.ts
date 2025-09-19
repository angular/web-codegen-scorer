import { join } from 'path';
import { rm, cp, readFile, writeFile } from 'fs/promises';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { globSync as glob } from 'tinyglobby';
import { executeCommand } from '../runner/utils/exec.js';

const root = join(import.meta.dirname, '..');
const runnerSource = join(root, 'runner');
const targetDirectory = join(root, 'dist');
const reportAppSource = join(root, 'report-app');
const reportAppDist = join(reportAppSource, 'dist');
const browserAgentRelativePath = 'runner/testing/browser-agent';

const args = yargs(hideBin(process.argv))
  .version(false)
  .option('runner-only', {
    type: 'boolean',
    default: false,
  })
  .option('version', {
    type: 'string',
    default: null,
  })
  .parseSync();

(async () => {
  console.log('Building release output...');

  // Clear out the target directory.
  await rm(targetDirectory, { recursive: true, force: true });

  // Build the runner. This also creates `dist`.
  await executeCommand('pnpm build-runner', runnerSource, undefined, {
    forwardStderrToParent: true,
  });

  // Generate the package.json.
  await writeFile(
    join(targetDirectory, 'package.json'),
    await getPackageJson(join(root, 'package.json'), args.version)
  );

  // Copy the readme and license.
  await cp(join(root, 'README.md'), join(targetDirectory, 'README.md'));
  await cp(join(root, 'LICENSE'), join(targetDirectory, 'LICENSE'));

  // Copy all the examples as is.
  await Promise.all(
    glob('**/*', {
      cwd: join(root, 'examples'),
      dot: true,
      ignore: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.vinxi/**',
        '**/.output/**',
      ],
    }).map((agentFile) =>
      cp(
        join(root, 'examples', agentFile),
        join(targetDirectory, 'examples', agentFile)
      )
    )
  );

  // The user journey testing requires various files to work.
  // Copy everything except the source TypeScript.
  await Promise.all(
    glob('**/*', {
      cwd: join(root, browserAgentRelativePath),
      dot: true,
      ignore: ['*.ts', 'README.md'],
    }).map((agentFile) =>
      cp(
        join(root, browserAgentRelativePath, agentFile),
        join(targetDirectory, browserAgentRelativePath, agentFile)
      )
    )
  );

  if (!args.runnerOnly) {
    // Build the report app and server.
    await executeCommand('pnpm build', reportAppSource, undefined, {
      forwardStderrToParent: true,
    });

    // Copy the report artifacts into the `dist`.
    await cp(reportAppDist, targetDirectory, { recursive: true });
  }

  console.log(`Release output has been built in ${targetDirectory}`);
})();

async function getPackageJson(
  path: string,
  version: string | null
): Promise<string> {
  const content = await readFile(path, 'utf8');
  const parsed = JSON.parse(content) as {
    version: string;
    scripts?: unknown;
    devDependencies?: unknown;
  };

  if (version) {
    if (version === parsed.version) {
      throw new Error(
        `Specified version is the same version as the current one.`
      );
    } else {
      parsed.version = version;
    }
  }

  // Delete some fields that aren't relevant for end users.
  delete parsed.scripts;
  delete parsed.devDependencies;

  return JSON.stringify(parsed, undefined, 2);
}
