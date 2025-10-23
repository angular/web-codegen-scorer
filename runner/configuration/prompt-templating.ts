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
    const content = readFileSync(fullPath, 'utf8');

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
