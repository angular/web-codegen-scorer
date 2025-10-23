import {readFileSync} from 'fs';
import Handlebars from 'handlebars';
import path, {dirname, resolve} from 'path';
import {UserFacingError} from '../utils/errors.js';

function initializeHandlebars() {
  Handlebars.registerHelper('neq', (a, b) => a !== b);
  Handlebars.registerPartial('embed', (ctx: {containingFile: string | null; file?: string}) => {
    if (!ctx.file) {
      throw new UserFacingError('file= is required');
    }
    if (!ctx.containingFile) {
      throw new UserFacingError('Cannot use `embed` if not `containingFile` is specified');
    }

    const fullPath = path.join(dirname(ctx.containingFile), ctx.file);
    let content = readFileSync(fullPath, 'utf8');
    content = processAtFileReferencesSync(content, fullPath);

    // Recursively support `embed`.
    return Handlebars.compile(content, {strict: true})({
      ...ctx,
      containingFile: fullPath,
    });
  });
}

initializeHandlebars();

/**
 * Renders the given prompt template, by supporting:
 *   - Handlebars builtins.
 *   - Handlebars `embed` custom partials for including other files.
 *   - Supporting the ecosystem `@<file-path>` standard for including other files.
 *
 * If `context` does not specify a `containingFile`, then other files cannot be embedded.
 */
export function renderPromptTemplate<T extends {containingFile: string | null}>(
  content: string,
  ctx: T,
) {
  content = ctx.containingFile ? processAtFileReferencesSync(content, ctx.containingFile) : content;

  const template = Handlebars.compile(content, {strict: true});
  const contextFiles: string[] = [];
  const result = template(ctx, {
    partials: {
      contextFiles: ctx => {
        if (typeof ctx !== 'string') {
          throw new UserFacingError(
            '`contextFiles` must receive a comma-separated list of file patterns, ' +
              "for example: `{{> contextFiles '**/*.ts, **/*.css, **/*.html' }}`",
          );
        }

        if (contextFiles.length > 0) {
          throw new UserFacingError(
            'There can be only one usage of `contextFiles` per prompt. ' +
              'Combine your usages into a single comma-separated string.',
          );
        }

        contextFiles.push(
          ...ctx
            .trim()
            .split(',')
            .map(p => p.trim()),
        );

        if (contextFiles.length === 0) {
          throw new UserFacingError('`contextFiles` cannot be empty.');
        }

        // Return an empty string to remove the context file syntax from the result.
        return '';
      },
    },
  });

  return {
    result,
    contextFiles,
  };
}

function processAtFileReferencesSync(content: string, containingFile: string): string {
  let newContent = content;
  let match;
  // Match all `@./<file-path>` or `@/<file-path>` occurrences.
  // If someone intends to write such text in their prompt, they could overcome this
  // by indenting the string, or adding arbitrary characters before front.
  const regex = /^@(\.?\/[^\s]+)/gm;
  const containingFileDir = dirname(containingFile);

  while ((match = regex.exec(newContent)) !== null) {
    const filePath = match[1];
    const fullPath = resolve(containingFileDir, filePath);
    let replacement: string;
    try {
      replacement = readFileSync(fullPath, 'utf8');
      // Note: If we start searching the match start, where the new embedded content begins,
      // we can trivially. process nested embeds via the `@` syntax.
    } catch (e) {
      throw new Error(
        `Unexpected error while embedding \`${match[0]}\` reference in ${containingFile}. ` +
          `Error: ${e}`,
      );
    }

    newContent =
      newContent.substring(0, match.index) +
      processAtFileReferencesSync(replacement, fullPath) +
      newContent.substring(regex.lastIndex);
  }
  return newContent;
}
