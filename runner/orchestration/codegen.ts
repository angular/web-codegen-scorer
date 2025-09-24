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
import { EvalID, Gateway } from './gateway.js';
import { LocalEnvironment } from '../configuration/environment-local.js';

/**
 * Generates code using the configured AI model based on the provided prompt.
 */
export async function generateCodeWithAI(
  llm: LlmRunner,
  model: string,
  codegenContext: LlmGenerateFilesContext,
  contextFiles: LlmContextFile[],
  abortSignal: AbortSignal
): Promise<LlmResponse> {
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
  evalID: EvalID,
  gateway: Gateway<Environment>,
  model: string,
  env: Environment,
  promptDef: RootPromptDefinition,
  directory: string,
  appFiles: LlmResponseFile[],
  errorMessage: string,
  errorContext: string,
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
    ...appFiles.map(
      (file) => `${file.filePath}:\n\`\`\`\n${file.code}\`\`\`\n\n`
    ),
  ].join('\n');

  const context: LlmGenerateFilesContext = {
    directory,
    systemInstructions: repairSystemInstructions,
    executablePrompt: repairPrompt,
    combinedPrompt: `${repairSystemInstructions}\n${repairPrompt}`,
    packageManager:
      env instanceof LocalEnvironment ? env.packageManager : undefined,
    buildCommand:
      env instanceof LocalEnvironment ? env.buildCommand : undefined,
    possiblePackageManagers: getPossiblePackageManagers().slice(),
  };

  progress.log(promptDef, 'codegen', 'Repairing code with AI');

  const response = await gateway.repairBuild(
    evalID,
    context,
    model,
    errorMessage,
    appFiles,
    contextFiles,
    abortSignal
  );

  if (response.success) {
    progress.log(
      promptDef,
      'codegen',
      'Received AI repair response',
      createLlmResponseTokenUsageMessage(response) ?? ''
    );
  } else {
    progress.log(
      promptDef,
      'error',
      'Failed to repair code with AI',
      response.errors.join(', ')
    );
  }

  return response;
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

export function createLlmResponseTokenUsageMessage(
  response: LlmResponse
): string | null {
  return response.usage.inputTokens ||
    response.usage.outputTokens ||
    response.usage.totalTokens
    ? `(input tokens: ${response.usage.inputTokens}, output tokens: ${response.usage.outputTokens}, total tokens: ${response.usage.totalTokens})`
    : null;
}
