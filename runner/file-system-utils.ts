import { join, dirname, isAbsolute } from 'path';
import { existsSync } from 'fs';
import {
  mkdir,
  copyFile,
  readdir,
  writeFile,
  lstat,
  symlink,
  rm,
  unlink,
} from 'fs/promises';

/**
 * Recursively copies a folder from a source path to a destination path,
 * optionally excluding specified subdirectories.
 *
 * @param source The path to the source folder.
 * @param destination The path to the destination folder.
 * @param exclude An optional set of directory names to exclude from copying.
 */
export async function copyFolderExcept(
  source: string,
  destination: string,
  exclude?: Set<string>
) {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);

    if (entry.isDirectory()) {
      if (!exclude || !exclude.has(entry.name)) {
        await copyFolderExcept(sourcePath, destinationPath);
      }
    } else {
      await copyFile(sourcePath, destinationPath);
    }
  }
}

/**
 * Removes a folder that may contain symlinks, but never deletes contents
 * inside symlinked directories.
 */
export async function removeFolderWithSymlinks(dir: string) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(dir, entry.name);

    if (entry.isSymbolicLink()) {
      await unlink(entryPath);
    }
    if (entry.isDirectory()) {
      await removeFolderWithSymlinks(entryPath);
    } else {
      await rm(entryPath);
    }
  }
}

/** Write a file and creates the necessary directory structure. */
export async function safeWriteFile(
  filePath: string,
  content: string | Buffer,
  encoding?: BufferEncoding
): Promise<void> {
  const directory = dirname(filePath);

  if (!existsSync(directory)) {
    await mkdir(directory, { recursive: true });
  }

  await writeFile(filePath, content, encoding);
}

/**
 * Creates a symbolic link from a source path to a target path if the target path
 * does not already exist.
 *
 * @param sourcePath - The path to the original file or directory.
 * @param targetPath - The path where the symbolic link should be created.
 * @returns A Promise that resolves when the symlink is created or if it already exists.
 *          The promise rejects if an error occurs other than the target path not existing.
 */
export async function createSymlinkIfNotExists(
  sourcePath: string,
  targetPath: string
): Promise<void> {
  try {
    await lstat(targetPath);
    // If lstat succeeds, path exists. Skip creating symlink.
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // Path does not exist, safe to create symlink
      await symlink(sourcePath, targetPath);
    } else {
      throw error; // Re-throw other errors
    }
  }
}

/**
 * Given a path that may be relative or absolute, returns either the absolute path itself
 * or resolves the relative path relative to the script's current working directory. This is
 * useful for CLI arguments where the users might pass either a relative or absolute path.
 * @param path Path to process.
 */
export function toProcessAbsolutePath(path: string): string {
  return isAbsolute(path) ? path : join(process.cwd(), path);
}
