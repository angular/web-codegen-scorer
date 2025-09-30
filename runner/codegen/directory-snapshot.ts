import {glob} from 'tinyglobby';
import {readFile} from 'fs/promises';
import {fileTypeFromBuffer} from 'file-type';

/** Represents a snapshot of a directory at a certain point in time. */
export class DirectorySnapshot {
  private constructor(
    readonly files: ReadonlyMap<string, string>,
    readonly directory: string,
  ) {}

  static async forDirectory(
    directory: string,
    ignoredPatterns: string[],
  ): Promise<DirectorySnapshot> {
    const paths = await glob('**/*', {
      cwd: directory,
      absolute: true,
      ignore: ignoredPatterns,
    });

    const files = new Map<string, string>();

    await Promise.all(
      paths.map(async path => {
        const buffer = await readFile(path);
        const binaryType = await fileTypeFromBuffer(buffer);

        // Don't try to stringify binary files.
        if (!binaryType) {
          files.set(path, buffer.toString());
        }
      }),
    );

    return new DirectorySnapshot(files, directory);
  }

  /**
   * Calculates the changed or added files compared a previous snapshot.
   * @param previous Snapshot to which to compare.
   */
  getChangedOrAddedFiles(previous: DirectorySnapshot): Map<string, string> {
    const result = new Map<string, string>();

    for (const [path, content] of this.files) {
      if (!previous.files.has(path) || previous.files.get(path) !== content) {
        result.set(path, content);
      }
    }

    return result;
  }
}
