import { BuildResultStatus } from '../../../../runner/workers/builder/builder-types';
import {
  AssessmentResult,
  RunInfo,
} from '../../../../runner/shared-interfaces';
import JsZip from 'jszip';

/**
 * Creates a ZIP file containing debugging information for a specific app.
 * The ZIP file includes the prompt, generated files, and any build/runtime errors.
 * @param run The run information containing the system prompt.
 * @param app The assessment result for which to create the debugging zip.
 * @returns A promise that resolves with the generated ZIP file as a Blob.
 */
export async function createPromptDebuggingZip(
  run: RunInfo,
  app: AssessmentResult
): Promise<Blob> {
  const zip = new JsZip();

  zip.file(
    'prompt.md',
    `${run.details.systemPromptGeneration}\n\n${app.promptDef.prompt}`
  );

  let generatedFiles = ``;
  for (const file of app.outputFiles) {
    generatedFiles += `### ${file.filePath}\n\n\`\`\`\n${file.code}\n\`\`\`\n`;
  }

  zip.file('generated-files.md', generatedFiles);

  let errors = ``;
  if (app.finalAttempt.serveTestingResult?.runtimeErrors) {
    errors += `## Runtime errors\n${app.finalAttempt.serveTestingResult?.runtimeErrors}\n`;
  }
  if (app.finalAttempt.buildResult.status === BuildResultStatus.ERROR) {
    errors += `## Build error\n  ${app.finalAttempt.buildResult.message}`;
  }

  zip.file('errors.md', errors);

  return await zip.generateAsync({
    type: 'blob',
    streamFiles: true,
  });
}
