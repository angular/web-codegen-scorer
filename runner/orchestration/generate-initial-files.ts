import {join} from 'node:path';
import {LocalLlmGenerateFilesResponse} from '../codegen/llm-runner.js';
import {Environment} from '../configuration/environment.js';
import {ProgressLogger} from '../progress/progress-logger.js';
import {
  AssessmentConfig,
  LlmContextFile,
  LlmGenerateFilesRequest,
  RootPromptDefinition,
  Usage,
} from '../shared-interfaces.js';
import {EvalID} from './executors/executor.js';
import {LLM_OUTPUT_DIR} from '../configuration/constants.js';
import {globSync} from 'tinyglobby';
import {UserFacingError} from '../utils/errors.js';
import {readFile} from 'node:fs/promises';
import {createLlmResponseTokenUsageMessage} from './codegen.js';

/**
 * Generates the initial files for a prompt using an LLM.
 * @param evalID ID of the eval for which files are generated.
 * @param model Name of the model used for generation.
 * @param env Environment that is currently being run.
 * @param promptName Name of the prompt being generated.
 * @param fullPromptText Full prompt to send to the LLM, including system instructions.
 * @param contextFiles Files that should be passed as context to the LLM.
 * @param localMode Whether the script is running in local mode.
 * @param abortSignal Signal to fire when this process should be aborted.
 */
export async function generateInitialFiles(
  options: AssessmentConfig,
  evalID: EvalID,
  env: Environment,
  promptDef: RootPromptDefinition,
  codegenRequest: LlmGenerateFilesRequest,
  contextFiles: LlmContextFile[],
  abortSignal: AbortSignal,
  progress: ProgressLogger,
): Promise<LocalLlmGenerateFilesResponse> {
  if (options.localMode) {
    const localFilesDirectory = join(LLM_OUTPUT_DIR, env.id, promptDef.name);
    const filePaths = globSync('**/*', {cwd: localFilesDirectory});

    if (filePaths.length === 0) {
      throw new UserFacingError(`Could not find pre-existing files in ${localFilesDirectory}`);
    }

    return {
      files: await Promise.all(
        filePaths.map(async filePath => ({
          filePath,
          code: await readFile(join(localFilesDirectory, filePath), 'utf8'),
        })),
      ),
      usage: {
        inputTokens: 0,
        outputTokens: 0,
      } satisfies Usage,
      // TODO: We could also try save/restore reasoning locally.
      reasoning: '',
      toolLogs: [],
    };
  }

  progress.log(promptDef, 'codegen', 'Generating code with AI');

  const response = await env.executor.generateInitialFiles(
    evalID,
    codegenRequest,
    options.model,
    contextFiles,
    abortSignal,
  );

  if (response.success) {
    progress.log(
      promptDef,
      'codegen',
      'Received AI code generation response',
      createLlmResponseTokenUsageMessage(response) ?? '',
    );
  } else {
    progress.log(promptDef, 'error', 'Failed to generate code with AI', response.errors.join(', '));
  }

  if (!response.success) {
    throw new Error(`Initial file generation failed: ${response.errors.join('\n')}`);
  }

  return {
    files: response.outputFiles!,
    usage: response.usage,
    reasoning: response.reasoning,
    toolLogs: response.toolLogs,
  };
}
