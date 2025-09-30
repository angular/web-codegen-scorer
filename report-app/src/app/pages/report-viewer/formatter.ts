import * as angularPlugin from 'prettier/plugins/angular.js';
import * as typeScriptPlugin from 'prettier/plugins/typescript.js';
import * as postcssPlugin from 'prettier/plugins/postcss.js';
import * as estreePlugin from 'prettier/plugins/estree.js';
import * as htmlPlugin from 'prettier/plugins/html.js';

import {LlmResponseFile, RunSummary} from '../../../../../runner/shared-interfaces';

export async function formatFile(
  file: LlmResponseFile,
  framework: RunSummary['framework'],
): Promise<string | {error: string}> {
  // We need to lazy-load Prettier to avoid warnings during SSR.
  const format = await import('prettier').then(m => m.format);
  let parser: import('prettier').BuiltInParserName;
  if (file.filePath.endsWith('.html')) {
    if (framework?.fullStackFramework.id === 'angular') {
      parser = 'angular';
    } else {
      parser = 'html';
    }
  } else if (file.filePath.endsWith('.ts') || file.filePath.endsWith('.tsx')) {
    parser = 'typescript';
  } else if (file.filePath.endsWith('.css')) {
    parser = 'css';
  } else {
    console.error('No parser for file path:', file.filePath);
    return {error: `No parser found for ${file.filePath}.`};
  }

  try {
    const result = await format(file.code, {
      filepath: file.filePath,
      parser,
      plugins: [
        angularPlugin,
        htmlPlugin,
        typeScriptPlugin,
        postcssPlugin,
        // This is tracked by https://github.com/prettier/prettier/issues/16501
        // @ts-expect-error Types for `estree` plugin seem to be missing.
        estreePlugin,
      ],
    });
    return result;
  } catch (e) {
    return {error: `Could not format: ${e}`};
  }
}
