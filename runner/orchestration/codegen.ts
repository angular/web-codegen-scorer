import {
  LlmContextFile,
  LlmResponse,
  LlmResponseFile,
  RootPromptDefinition,
  ToolLogEntry,
  Usage,
} from '../shared-interfaces.js';
import {
  LlmGenerateFilesContext,
  LlmRunner,
  PromptDataMessage,
} from '../codegen/llm-runner.js';
import { Environment } from '../configuration/environment.js';
import { getPossiblePackageManagers } from '../configuration/environment-config.js';
import { ProgressLogger } from '../progress/progress-logger.js';

/**
 * Generates code using the configured AI model based on the provided prompt.
 *
 * @param llm LLM runner.
 * @param model Name of the LLM to use.
 * @param userPrompt The user prompt to send to the AI model.
 * @param requestType Type of the request: "codegen" or "repair"
 * @param appName Name of the app that we want to generate.
 * @returns A Promise that resolves with the generated code string.
 *          Returns `null` if an error occurs during generation.
 */
export async function generateCodeWithAI(
  llm: LlmRunner,
  model: string,
  codegenContext: LlmGenerateFilesContext,
  requestType: 'codegen' | 'repair',
  promptDef: RootPromptDefinition,
  contextFiles: LlmContextFile[],
  abortSignal: AbortSignal,
  progress: ProgressLogger
): Promise<LlmResponse> {
  progress.log(
    promptDef,
    'codegen',
    requestType === 'repair'
      ? 'Repairing code with AI'
      : 'Generating code with AI'
  );

  const outputFiles: LlmResponseFile[] = [];
  const filesToIndexes = new Map<string, number>();
  const errors: string[] = [];
  let usage: Usage;
  let success: boolean;
  let reasoning: string;
  let toolLogs: ToolLogEntry[];

  const contextMessageData = prepareContextFilesMessage(contextFiles);
  const messages: PromptDataMessage[] | undefined = contextMessageData
    ? [contextMessageData]
    : [];

  try {
    const response = await llm.generateFiles({
      messages,
      context: codegenContext,
      model,
      thinkingConfig: {
        includeThoughts: true,
      },
      abortSignal,
    });

    usage = {
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: response.usage?.outputTokens ?? 0,
      totalTokens: response.usage?.totalTokens ?? 0,
    };
    reasoning = response.reasoning;
    toolLogs = response.toolLogs ?? [];

    progress.log(
      promptDef,
      'codegen',
      requestType === 'repair'
        ? 'Received AI repair response'
        : 'Received AI code generation response',
      usage.inputTokens || usage.outputTokens || usage.totalTokens
        ? `(input tokens: ${usage.inputTokens}, output tokens: ${usage.outputTokens}, total tokens: ${usage.totalTokens})`
        : ''
    );

    for (const file of response.files) {
      // In some cases the LLM appears to split the file up into individual objects,
      // rather than in a single one. If that's the case, stitch the files together,
      // rather than letting the file system override them further down.
      if (filesToIndexes.has(file.filePath)) {
        outputFiles[filesToIndexes.get(file.filePath)!].code += file.code;
      } else {
        filesToIndexes.set(file.filePath, outputFiles.push(file) - 1);
      }
    }

    success = true;
  } catch (error) {
    usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    success = false;
    reasoning = '';
    toolLogs = [];
    errors.push(error + '');
    progress.log(
      promptDef,
      'error',
      requestType === 'repair'
        ? 'Failed to repair code with AI'
        : 'Failed to generate code with AI',
      error + ''
    );
  }

  return {
    success,
    outputFiles,
    errors,
    usage,
    reasoning,
    toolLogs,
  } satisfies LlmResponse;
}

/**
 * Attempts to repair the given code using an AI model based on the provided error message.
 */
export async function repairCodeWithAI(
  llm: LlmRunner,
  env: Environment,
  model: string,
  directory: string,
  files: LlmResponseFile[],
  errorMessage: string,
  errorContext: string,
  promptDef: RootPromptDefinition,
  contextFiles: LlmContextFile[],
  abortSignal: AbortSignal,
  progress: ProgressLogger
): Promise<LlmResponse> {
  const repairSystemInstructions = env.systemPromptRepair();
  const repairPrompt = [
    errorContext,
    '```',
    errorMessage,
    '```',
    '',
    'In the following source code:',
    ...files.map((file) => `${file.filePath}:\n\`\`\`\n${file.code}\`\`\`\n\n`),
  ].join('\n');

  const context: LlmGenerateFilesContext = {
    directory,
    systemInstructions: repairSystemInstructions,
    executablePrompt: repairPrompt,
    combinedPrompt: `${repairSystemInstructions}\n${repairPrompt}`,
    packageManager: env.packageManager,
    possiblePackageManagers: getPossiblePackageManagers().slice(),
    buildCommand: env.buildCommand,
  };

  return generateCodeWithAI(
    llm,
    model,
    context,
    'repair',
    promptDef,
    contextFiles,
    abortSignal,
    progress
  );
}

export function prepareContextFilesMessage(
  contextFiles: LlmContextFile[]
): PromptDataMessage | null {
  if (contextFiles.length === 0) {
    return null;
  }

  let contextMessage = 'Available context files are listed below\n\n';

  for (const file of contextFiles) {
    contextMessage += `\nFile name: \`${file.relativePath}\`\n\n\`\`\`${file.content}\`\`\`\n\n`;
  }

  return {
    role: 'user',
    content: [{ text: contextMessage }],
  };
}
