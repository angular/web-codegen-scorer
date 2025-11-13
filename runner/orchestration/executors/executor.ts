import PQueue from 'p-queue';
import {ProgressLogger} from '../../progress/progress-logger.js';
import {
  LlmContextFile,
  LlmGenerateFilesRequest,
  LlmResponse,
  LlmResponseFile,
  RootPromptDefinition,
  TestExecutionResult,
} from '../../shared-interfaces.js';
import {BuildResult} from '../../workers/builder/builder-types.js';
import z from 'zod';
import {ServeTestingResult} from '../../workers/serve-testing/worker-types.js';

export type EvalID = string & {__evalID: true};

// Needed for portability of the `PQueue` type.
export type WorkerQueueType = PQueue;

export const executorSchema = z.object({
  initializeEval: z.function(z.tuple([]), z.promise(z.custom<EvalID>())),
  generateInitialFiles: z.function(
    z.tuple([
      z.custom<EvalID>().describe('ID of the eval'),
      z.custom<LlmGenerateFilesRequest>().describe('Request info'),
      z.string().describe('Configured model for the generation request'),
      z.array(z.custom<LlmContextFile>()).describe('Context files for the generation request.'),
      z.custom<AbortSignal>().describe('Abort Signal to fire when the request should be canceled.'),
    ]),
    z.promise(z.custom<LlmResponse>()),
  ),
  generateRepairFiles: z.function(
    z.tuple([
      z.custom<EvalID>().describe('ID of the eval'),
      z.custom<LlmGenerateFilesRequest>().describe('Request info'),
      z.string().describe('Configured model for the generation request'),
      z.string().describe('Error Message that should be repaired'),
      z.array(z.custom<LlmResponseFile>()).describe('App files that were generated before.'),
      z.array(z.custom<LlmContextFile>()).describe('Context files for the generation request.'),
      z.custom<AbortSignal>().describe('Abort Signal to fire when the request should be canceled.'),
    ]),
    z.promise(z.custom<LlmResponse>()),
  ),
  shouldRepairFailedBuilds: z.function(
    z.tuple([z.custom<EvalID>().describe('ID of the eval')]),
    z.promise(z.boolean()),
  ),
  performBuild: z.function(
    z.tuple([
      z.custom<EvalID>().describe('ID of the eval'),
      z.string().describe('Path to the application directory'),
      z.custom<RootPromptDefinition>().describe('Root prompt definition'),
      z
        .custom<WorkerQueueType>()
        .describe('Worker concurrency queue. Use this for limiting local workers.'),
      z.custom<AbortSignal>().describe('Abort Signal to fire when the request should be canceled.'),
      z.custom<ProgressLogger>().describe('Progress logger'),
    ]),
    z.promise(z.custom<BuildResult>()),
  ),
  serveWebApplication: z
    .function(
      z.tuple([
        z.custom<EvalID>().describe('ID of the eval'),
        z.string().describe('Path to the application directory'),
        z.custom<RootPromptDefinition>().describe('Root prompt definition'),
        z.custom<ProgressLogger>().describe('Progress logger'),
        z
          .custom<AbortSignal>()
          .describe('Abort Signal to fire when the server should be canceled.'),
        z
          .function(
            z.tuple([z.string().describe('URL of the running server')]),
            z.promise(z.custom<ServeTestingResult>()),
          )
          .describe('Call this function while the server is running'),
      ]),
      z.promise(z.union([z.custom<ServeTestingResult>(), z.null()])),
    )
    .nullable(),
  executeProjectTests: z.function(
    z.tuple([
      z.custom<EvalID>().describe('ID of the eval'),
      z.string().describe('Path to the application directory'),
      z.custom<RootPromptDefinition>().describe('Root prompt definition'),
      z
        .custom<WorkerQueueType>()
        .describe('Worker concurrency queue. Use this for limiting local workers.'),
      z.custom<AbortSignal>().describe('Abort Signal to fire when tests should be canceled.'),
      z.custom<ProgressLogger>().describe('Progress logger'),
    ]),
    z.promise(z.custom<TestExecutionResult>().nullable()),
  ),
  finalizeEval: z.function(
    z.tuple([z.custom<EvalID>().describe('ID of the eval')]),
    z.promise(z.void()),
  ),
  isSupportedModel: z.function(
    z.tuple([z.string().describe('Model specified via command line flag')]),
    z.promise(
      z.object({
        supported: z.boolean(),
        availableModels: z
          .array(z.string())
          .optional()
          .describe('List of available models, if known.'),
      }),
    ),
  ),
  postProcessSystemPrompt: z
    .function(
      z.tuple([z.string().describe('Prompt'), z.string().describe('Environment root path')]),
      z.promise(z.string()),
    )
    .optional(),
  destroy: z.function(z.tuple([]), z.promise(z.void())),
  getExecutorInfo: z.function(
    z.tuple([]),
    z.promise(
      z.object({
        id: z.string().describe('Unique ID of the executor'),
        displayName: z.string().describe('Display name of the runner'),
        mcpServersLaunched: z.number().describe('Number of MCP servers launched'),
      }),
    ),
  ),
});

export type Executor = z.infer<typeof executorSchema>;
