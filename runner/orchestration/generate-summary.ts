import {AiSdkRunner} from '../codegen/ai-sdk/ai-sdk-runner.js';
import {Environment} from '../configuration/environment.js';
import {redX} from '../reporting/format.js';
import {chatWithReportAI} from '../reporting/report-ai-chat.js';
import {summarizeReportWithAI} from '../reporting/report-ai-summary.js';
import {AssessmentResult, CompletionStats, RunSummary} from '../shared-interfaces.js';

/**
 * Prepares a summary of build statuses and score distributions from a list of assessment results
 * and also some extra metadata about the run.
 */
export async function prepareSummary(
  generateAiSummaryLlm: AiSdkRunner | null,
  abortSignal: AbortSignal,
  evalRunModel: string,
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
    console.log(`✨ Generating AI summary for evaluation run...`);
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

  const additionalAiAnalysis: {name: string; summary: string}[] = [];
  if (generateAiSummaryLlm && env.analysisPrompts.length > 0) {
    console.log(`✨ Generating additional AI analysis...`);

    await Promise.all(
      env.analysisPrompts.map(async config => {
        try {
          const result = await chatWithReportAI(
            generateAiSummaryLlm,
            config.prompt,
            abortSignal,
            assessments,
            [],
            config.model,
            {
              reportContextFilter: config.reportsFilter,
              ratingContextFilter: config.ratingsFilter,
            },
            undefined,
          );
          inputTokens += result.usage.inputTokens;
          outputTokens += result.usage.outputTokens;
          thinkingTokens += result.usage.thinkingTokens;
          totalTokens += result.usage.totalTokens;
          additionalAiAnalysis.push({name: config.name, summary: result.responseHtml});
        } catch (e) {
          console.log(`${redX()} Failed custom analysis called "${config.name}".`);

          if (process.env.DEBUG === '1' && (e as Partial<Error>).stack) {
            console.error((e as Error).stack);
          }
        }
      }),
    );
  }

  const executorInfo = await env.executor.getExecutorInfo?.();

  return {
    model: evalRunModel,
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
    additionalAiAnalysis,
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
