import ts from 'typescript';
import {LlmResponseFile} from '../shared-interfaces.js';

/**
 * Extracts embedded stylesheets and HTML from a TypeScript file.
 * @param source Source code of the file.
 */
export function extractEmbeddedCodeFromTypeScript(file: LlmResponseFile) {
  // We currently only support extracting embedded code from Angular.
  // Early-exit if we don't detect a component.
  if (!file.code.includes('@Component(')) {
    return null;
  }

  const sourceFile = ts.createSourceFile('temp.ts', file.code, ts.ScriptTarget.Latest);

  const stylesheets: string[] = [];
  const templates: string[] = [];

  sourceFile.forEachChild(function walk(node: ts.Node) {
    if (
      ts.isDecorator(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'Component' &&
      node.expression.arguments.length > 0 &&
      ts.isObjectLiteralExpression(node.expression.arguments[0])
    ) {
      for (const prop of node.expression.arguments[0].properties) {
        if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
          continue;
        }

        if (prop.name.text === 'template' && ts.isStringLiteralLike(prop.initializer)) {
          templates.push(prop.initializer.text);
        } else if (prop.name.text === 'styles') {
          if (ts.isStringLiteralLike(prop.initializer)) {
            stylesheets.push(prop.initializer.text);
          } else if (ts.isArrayLiteralExpression(prop.initializer)) {
            for (const el of prop.initializer.elements) {
              if (ts.isStringLiteralLike(el)) {
                stylesheets.push(el.text);
              }
            }
          }
        }
      }
    }

    node.forEachChild(walk);
  });

  return {
    stylesheets: stylesheets.map(c => ({code: c, filePath: file.filePath})),
    templates: templates.map(c => ({code: c, filePath: file.filePath})),
  };
}
