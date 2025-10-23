import {readFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';

/**
 * Finds all `@<file-link>` in given content and recursively embeds the
 * references files.
 *
 * @param content The starting prompt which may contain `@` file links.
 * @param containingFile The file path of the given content.
 * @param fakeRoot An optional fake root to control where absolute `@/<path>` links should start.
 */
export async function replaceAtReferencesInPrompt(
  content: string,
  containingFile: string,
  fakeRoot?: string,
): Promise<string> {
  let newContent = content;
  // Match all `@./<file-path>`, `@../<file-path>` or `@/<file-path>` occurrences.
  // If someone intends to write such text in their prompt, they could overcome this
  // by indenting the string, or adding arbitrary characters before front.
  const regex = /^@(\.?\.?\/[^\s]+)/gm;
  const containingFileDir = dirname(containingFile);
  const matches = [...newContent.matchAll(regex)];

  const replacements = await Promise.all(
    matches.map(async match => {
      let filePath = match[1];
      if (filePath.startsWith('/') && fakeRoot) {
        filePath = join(fakeRoot, filePath);
      }

      const fullPath = resolve(containingFileDir, filePath);
      try {
        const replacementContent = await readFile(fullPath, 'utf8');
        // Note: If we start searching the match start, where the new embedded content begins,
        // we can trivially. process nested embeds via the `@` syntax.
        return {
          start: match.index!,
          end: match.index! + match[0].length,
          content: await replaceAtReferencesInPrompt(replacementContent, fullPath, fakeRoot),
        };
      } catch (e) {
        throw new Error(
          `Unexpected error while embedding \`${match[0]}\` reference in ${containingFile}. ` +
            `Error: ${e}`,
        );
      }
    }),
  );

  // Apply replacements in reverse order to avoid index shifts.
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    newContent =
      newContent.substring(0, replacement.start) +
      replacement.content +
      newContent.substring(replacement.end);
  }
  return newContent;
}
