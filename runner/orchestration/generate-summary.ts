import {GenkitRunner} from '../codegen/genkit/genkit-runner.js';
import {Environment} from '../configuration/environment.js';
import {redX} from '../reporting/format.js';
import {summarizeReportWithAI} from '../reporting/report-ai-summary.js';
import {AssessmentResult, CompletionStats, RunSummary} from '../shared-interfaces.js';

/**
 * Prepares a summary of build statuses and score distributions from a list of assessment results
 * and also some extra metadata about the run.
 */
export async function prepareSummary(
  generateAiSummaryLlm: GenkitRunner | null,
  abortSignal: AbortSignal,
  model: string,
  env: Environment,
  assessments: AssessmentResult[],
  completionStats: CompletionStats,
): Promise<RunSummary> {
  let inputTokens = 0;
  let outputTokens = 0;
  let thinkingTokens = 0;
  let totalTokens = 0;

  assessments.forEach(result => {
    // Incorporate usage from running raters.
    if (result.score.tokenUsage) {
      inputTokens += result.score.tokenUsage.inputTokens;
      outputTokens += result.score.tokenUsage.outputTokens;
      totalTokens += result.score.tokenUsage.totalTokens;
      thinkingTokens += result.score.tokenUsage.thinkingTokens;
    }

    // Incorporate usage numbers from all generate + build attempts.
    result.attemptDetails.forEach(attempt => {
      if (attempt.usage) {
        inputTokens += attempt.usage.inputTokens;
        outputTokens += attempt.usage.outputTokens;
        totalTokens += attempt.usage.totalTokens;
        thinkingTokens += attempt.usage.thinkingTokens;
      }
    });
  });

  let aiSummary: string | undefined = undefined;
  if (generateAiSummaryLlm) {
    console.log(`✨ Generating AI summary for evaluation run..`);
    try {
      const result = await summarizeReportWithAI(generateAiSummaryLlm, abortSignal, assessments);
      inputTokens += result.usage.inputTokens;
      outputTokens += result.usage.outputTokens;
      thinkingTokens += result.usage.thinkingTokens;
      totalTokens += result.usage.totalTokens;
      aiSummary = result.responseHtml;
      console.log(`✅ Generated AI summary.`);
    } catch (e) {
      console.log(`${redX()} Failed to generate AI summary, skipping summary.`);

      if (process.env.DEBUG === '1' && (e as Partial<Error>).stack) {
        console.error((e as Error).stack);
      }
    }
  }

  const executorInfo = await env.executor.getExecutorInfo?.();

  return {
    model,
    environmentId: env.id,
    displayName: env.displayName,
    framework: {
      fullStackFramework: {
        id: env.fullStackFramework.id,
        displayName: env.fullStackFramework.displayName,
      },
      clientSideFramework: {
        id: env.clientSideFramework.id,
        displayName: env.clientSideFramework.displayName,
      },
    },
    aiSummary,
    completionStats: completionStats,
    usage: {
      inputTokens,
      outputTokens,
      thinkingTokens,
      totalTokens,
    },
    runner: {
      id: executorInfo.id,
      displayName: executorInfo.displayName,
    },
    ratingHash: env.ratingHash,
  } satisfies RunSummary;
}
