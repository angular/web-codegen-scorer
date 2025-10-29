import {marked} from 'marked';
import {GenkitRunner} from '../codegen/genkit/genkit-runner.js';
import {
  AiChatMessage,
  AssessmentResult,
  IndividualAssessment,
  IndividualAssessmentState,
  ReportContextFilter,
  RatingContextFilter,
  AiChatContextFilters,
  AssessmentResultFromReportServer,
} from '../shared-interfaces.js';
import {BuildResultStatus} from '../workers/builder/builder-types.js';
import {BUCKET_CONFIG} from '../ratings/stats.js';
import {POINTS_FOR_CATEGORIES} from '../ratings/rating-types.js';

export const reportLlmEvalsToolContext = `## What is a report?
A report consists of many apps that were LLM generated. You will have information
about checks that failed for this LLM generated app.

Note that there may be multiple attempts for an app. E.g. an initial build may fail and
another attempt might have repaired the build failure. The last attempt reflects the final
state of the app. E.g. whether it does build, or if there are runtime errors.

## Scoring mechanism
Apps are rated based on their scores in the following buckets:
${BUCKET_CONFIG.map(b => `* ${b.name}: ${b.min}-${b.max}`).join('\n')}

The overall score of an app is determined based on score reductions.
There are three pillars: ${Object.keys(POINTS_FOR_CATEGORIES).join(', ')}
Pillars are a split up of a 100% perfect score, allowing for individual ratings
to be less impactful than others. The pillars are distributed as follows:
${Object.entries(POINTS_FOR_CATEGORIES).map(e => `* ${e[0]}: ${e[1]} points.`)}
Within pillars, the available score can be reduced by individual ratings.
`;

const defaultAiChatPrompt = `Strictly follow the instructions here.
- You are an expert in LLM-based code generation evaluation and quality assessments.
- You are a chat bot that has insight into the reports of an evaluation tool that describes LLM-generated code quality.
- You MUST respond to the users question/message. Do not reply with unnecessary information the user didn't ask for.
- Quote exact build failures, or assessment checks when possible.
- Return aesthetically pleasing Markdown for the response. You can use inline styles for colors.
- Answer the user's question about the report.

--
**CRITICAL**:
  * Answer the user's question.
  * Decide based on the question, whether you need to generate a larger response, or just a chat reply.`;

export async function chatWithReportAI(
  llm: GenkitRunner,
  message: string,
  abortSignal: AbortSignal,
  allAssessments: AssessmentResultFromReportServer[] | AssessmentResult[],
  pastMessages: AiChatMessage[],
  model: string,
  contextFilters: AiChatContextFilters,
  activeReportIDs: string[] | undefined,
) {
  let assessmentsToProcess = allAssessments;

  // Report context filtering
  if (contextFilters.reportContextFilter === ReportContextFilter.ActiveReports) {
    assessmentsToProcess = allAssessments.filter(
      a => isAssessmentResultWithID(a) && activeReportIDs?.includes(a.id),
    );
  } else if (contextFilters.reportContextFilter === ReportContextFilter.NonPerfectReports) {
    assessmentsToProcess = allAssessments.filter(
      assessment => assessment.score.totalPoints < assessment.score.maxOverallPoints,
    );
  }

  let filterDescription = '';
  if (contextFilters.reportContextFilter === ReportContextFilter.ActiveReports) {
    filterDescription =
      `The user filtered to only show active apps (${assessmentsToProcess.length} apps). ` +
      `You only have information about a subset of the total apps. ` +
      `If asked for information about inactive apps, ask the user to update the context setting, or select more apps.`;
  } else if (contextFilters.reportContextFilter === ReportContextFilter.NonPerfectReports) {
    filterDescription =
      `The user filtered to only show non-perfect apps (${assessmentsToProcess.length} apps). ` +
      `You only have information about a subset of the total apps. ` +
      `If asked for information about perfect apps, ask the user to update the context setting.`;
  }

  const prompt = `\n${defaultAiChatPrompt}

### User Question/Message
\`\`\`
${message}
\`\`\`

${reportLlmEvalsToolContext}

### How many apps are there?
There are ${allAssessments.length} apps in this report.
${filterDescription}

### Apps:
${serializeReportForPrompt(assessmentsToProcess, contextFilters)}
`;

  const result = await llm.generateText({
    prompt: prompt,
    model: model,
    messages: pastMessages.map(m => ({role: m.role, content: [{text: m.text}]})),
    thinkingConfig: {
      includeThoughts: false,
    },
    timeout: {
      description: `Generating summary for report`,
      durationInMins: 3,
    },
    abortSignal,
  });

  return {
    responseHtml: await marked(result.text, {}),
    usage: {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      totalTokens: result.usage?.totalTokens ?? 0,
    },
  };
}

export function serializeReportForPrompt(
  assessments: AssessmentResult[],
  contextFilters: AiChatContextFilters,
): string {
  const onlyNonPerfectRatings =
    contextFilters.ratingContextFilter === RatingContextFilter.NonPerfectRatings;

  return assessments
    .map(app => {
      let checksToSerialize = app.score.categories.flatMap(category => category.assessments);
      if (onlyNonPerfectRatings) {
        checksToSerialize = checksToSerialize.filter(
          (a): a is IndividualAssessment =>
            a.state === IndividualAssessmentState.EXECUTED && a.successPercentage < 1,
        );
      }

      const checksLabel = onlyNonPerfectRatings ? 'Failed checks/ratings' : 'Checks/ratings';

      return `
Name: ${app.promptDef.name}
Score: ${app.score.totalPoints}/${app.score.maxOverallPoints}
${checksLabel}: ${JSON.stringify(
        checksToSerialize.map(c => {
          if (c.state === IndividualAssessmentState.SKIPPED) {
            return {
              description: c.description,
              category: c.category,
              message: c.message,
              state: 'skipped',
            };
          }
          return {
            description: c.description,
            category: c.category,
            scoreReduction: c.scoreReduction,
            message: c.message,
            success: c.successPercentage === 1,
          };
        }),
        null,
        2,
      )}
Attempts: ${JSON.stringify(
        app.attemptDetails.map(a => ({
          attemptIndex: a.attempt,
          buildResult: {
            message: a.buildResult.message,
            status: a.buildResult.status === BuildResultStatus.ERROR ? 'Error' : 'Success',
          },
          serveTestingResult: {
            runtimeErrors: a.serveTestingResult?.runtimeErrors,
            axeViolations: a.serveTestingResult?.axeViolations,
            cspViolations: a.serveTestingResult?.cspViolations,
          },
        })),
        null,
        2,
      )}`;
    })
    .join('\n------------\n');
}

function isAssessmentResultWithID(
  value: AssessmentResult | AssessmentResultFromReportServer,
): value is AssessmentResultFromReportServer {
  return (value as Partial<AssessmentResultFromReportServer>).id !== undefined;
}
