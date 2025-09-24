import { tmpdir } from 'os';
import { LLM_OUTPUT_DIR } from '../configuration/constants.js';
import { Environment } from '../configuration/environment.js';
import {
  copyFolderExcept,
  createSymlinkIfNotExists,
  removeFolderWithSymlinks,
  safeWriteFile,
} from '../file-system-utils.js';
import {
  LlmContextFile,
  LlmResponseFile,
  RootPromptDefinition,
} from '../shared-interfaces.js';
import { join } from 'path';
import { existsSync } from 'fs';
import { mkdir, mkdtemp, readFile } from 'fs/promises';
import { globSync } from 'tinyglobby';
import { executeCommand } from '../utils/exec.js';
import { UserFacingError } from '../utils/errors.js';
import { ProgressLogger } from '../progress/progress-logger.js';
import { LocalEnvironment } from '../configuration/environment-local.js';

const SYMLINK_PROJECT_PATHS = new Set(['node_modules']);
const PENDING_INSTALLS = new Map<string, Promise<void>>();

/**
 * Sets up the structure in which the LLM should build the application.
 * @param env Environment that is currently being run.
 * @param rootPromptDef Definition of the root prompt.
 * @param progress Logger to use to log out the current progress.
 * @param outputDirectory Custom output directory specified by the user.
 * @returns Temporary directory in which to build and a function used to clean in up.
 */
export async function setupProjectStructure(
  env: Environment,
  rootPromptDef: RootPromptDefinition,
  progress: ProgressLogger,
  outputDirectory?: string
) {
  let directory: string;
  let cleanup: () => Promise<void>;

  if (outputDirectory) {
    // Use a less random name when the output directory
    // is specified since the main use case is debugging.
    directory = join(outputDirectory, env.id, rootPromptDef.name);

    await mkdir(directory, { recursive: true });

    // Don't clean up the custom output directory so it can be inspected.
    cleanup = () => Promise.resolve();
  } else {
    // When outputting to the temporary directory, make sure that the directory is unique.
    directory = await mkdtemp(
      join(tmpdir(), `fw-${env.id}-build-${rootPromptDef.name}`)
    );

    cleanup = async () => {
      try {
        await removeFolderWithSymlinks(directory);
      } catch {}
    };
  }

  const directoriesToCopy: string[] = [];

  if (env instanceof LocalEnvironment && env.projectTemplatePath) {
    // Copy the template files first.
    directoriesToCopy.push(env.projectTemplatePath);

    // Run the install command in the template directory directly. This way multiple
    // evals can reuse the same dependencies. It also allows pnpm workspaces to work
    // properly since we might not have copied the `pnpm-workspaces.yml`.
    if (!env.isBuiltIn) {
      await installDependenciesInDirectory(
        env,
        rootPromptDef,
        env.projectTemplatePath,
        progress
      );
    }
  }

  if (env instanceof LocalEnvironment && env.sourceDirectory) {
    // Push this after the project so the environment's files that precedence.
    directoriesToCopy.push(env.sourceDirectory);

    // Also try to install dependencies in the source directory,
    // because it may be overriding the ones from the template.
    if (!env.isBuiltIn) {
      await installDependenciesInDirectory(
        env,
        rootPromptDef,
        env.sourceDirectory,
        progress
      );
    }
  }

  for (const dirToCopy of directoriesToCopy) {
    await copyFolderExcept(dirToCopy, directory, SYMLINK_PROJECT_PATHS);

    if (!env.isBuiltIn) {
      for (const symlinkPath of SYMLINK_PROJECT_PATHS) {
        await createSymlinkIfNotExists(
          join(dirToCopy, symlinkPath),
          join(directory, symlinkPath)
        );
      }
    }
  }

  // If the environment is built in, it'll likely be inside of the user's `node_modules`.
  // Since running an installation inside `node_modules` can be problematic, we install
  // in the temporary directory instead. This can be slower, but is more reliable.
  if (env instanceof LocalEnvironment && env.isBuiltIn) {
    await installDependenciesInDirectory(
      env,
      rootPromptDef,
      directory,
      progress
    );
  }

  return { directory, cleanup };
}

/** Run the package manager install command in a specific directory. */
function installDependenciesInDirectory(
  env: LocalEnvironment,
  rootPromptDef: RootPromptDefinition,
  directory: string,
  progress: ProgressLogger
): Promise<void> {
  // The install script will error out if there's no `package.json`.
  if (env.skipInstall || !existsSync(join(directory, 'package.json'))) {
    return Promise.resolve();
  }

  const key = `${directory}#${env.installCommand}`;
  let pendingCommand = PENDING_INSTALLS.get(key);
  progress.log(rootPromptDef, 'build', 'Installing dependencies');

  // There may be multiple evals trying to install in the same directory.
  // Reuse the promise so they don't trigger multiple installation processes.
  if (pendingCommand) {
    return pendingCommand;
  }

  pendingCommand = executeCommand(env.installCommand, directory, undefined, {
    forwardStderrToParent: true,
  })
    .then(() => {
      return undefined;
    })
    .catch(() => {
      throw new UserFacingError(
        `Failed to install dependencies in ${directory}`
      );
    })
    .finally(() => {
      PENDING_INSTALLS.delete(key);
    });

  PENDING_INSTALLS.set(key, pendingCommand);
  return pendingCommand;
}

/**
 * Resolves the files that should be passed to the LLM as context for requests.
 * @param patterns Patterns used to resolve the context files.
 * @param directory Directory in which to search for context files.
 */
export async function resolveContextFiles(
  patterns: string[],
  directory: string
): Promise<LlmContextFile[]> {
  if (patterns.length === 0) {
    return Promise.resolve([]);
  }

  const paths = globSync(patterns, {
    cwd: directory,
    ignore: [
      '**/node_modules/**',
      '**/README.md',
      '**/package-lock.json',
      '**/package.json',
      '**/angular.json',
      '**/.vinxi/**',
    ],
  });

  return Promise.all(
    paths.map(async (relativePath) => ({
      relativePath,
      content: await readFile(join(directory, relativePath), 'utf8'),
    }))
  );
}

/**
 * Writes the files that the LLM responded with to disk.
 * @param directory Directory in which to write the files.
 * @param files Files to be written.
 * @param env Environment that is currently being run.
 * @param promptName Name of the prompt under which to output the files.
 */
export async function writeResponseFiles(
  directory: string,
  files: LlmResponseFile[],
  env: Environment,
  promptName: string
): Promise<void> {
  const llmOutputDir = join(LLM_OUTPUT_DIR, env.id, promptName);
  const filePromises = files.map(async (file) => {
    // Write file to a tmp folder first for debugging
    await safeWriteFile(join(llmOutputDir, file.filePath), file.code);

    // Overwrite the target component file in the temporary location with the LLM's code
    await safeWriteFile(join(directory, file.filePath), file.code);
  });

  await Promise.all(filePromises);
}
