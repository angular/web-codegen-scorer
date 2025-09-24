import { marked } from 'marked';
import { BuildResultStatus } from '../workers/builder/builder-types.js';
import { GenkitRunner } from '../codegen/genkit/genkit-runner.js';
import {
  AssessmentResult,
  IndividualAssessment,
  IndividualAssessmentState,
} from '../shared-interfaces.js';

export async function summarizeReportWithAI(
  llm: GenkitRunner,
  abortSignal: AbortSignal,
  assessments: AssessmentResult[]
) {
  const totalApps = assessments.length;
  const prompt = `\
Strictly follow the instructions here.
- You are an expert in LLM-based code generation evaluation and quality assessments.
- You will receive a report of an evaluation tool that describes LLM-generated code quality. Summarize/categorize the report.
- Quote exact build failures, or assessment checks when possible.
- Try to keep the summary short. e.g. cut off app names to reduce output length.
- Return aesthetically pleasing Markdown for the report. You can use inline styles for colors.

**Your primary goals (two)**:
  - Make it easy to understand what common failures are,
  - Make it easy to identify low-hanging fruit that we can fix to improve code generation for LLMs.

## What is a report?
A report consists of many apps that were LLM generated. You will have information
about checks that failed for this LLM generated app.

## Report
The report contains ${totalApps} apps.

### Apps:
${serializeReportForPrompt(assessments)}


--
Categorize the failures and provide a brief summary of the report. Keep it short but insightful!
`;

  const result = await llm.generateText({
    prompt: prompt,
    model: 'gemini-2.5-flash-lite',
    timeout: {
      description: `Generating summary for report`,
      durationInMins: 3,
    },
    abortSignal,
  });

  return {
    summary: await marked(result.text, {}),
    usage: {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      totalTokens: result.usage?.totalTokens ?? 0,
    },
  };
}

function serializeReportForPrompt(assessments: AssessmentResult[]): string {
  return assessments
    .map(
      (app) =>
        `\
Name: ${app.promptDef.name}
Score: ${app.score.totalPoints}/${app.score.maxOverallPoints}
Failed checks: ${JSON.stringify(
          app.score.categories
            .flatMap((category) => category.assessments)
            .filter(
              (a): a is IndividualAssessment =>
                a.state === IndividualAssessmentState.EXECUTED &&
                a.successPercentage < 1
            )
            .map((c) => ({
              description: c.description,
              points: `${(c.successPercentage * 100).toFixed(2)}/100`,
              message: c.message,
            })),
          null,
          2
        )}
Build results: ${JSON.stringify(
          app.attemptDetails.map((a) => ({
            buildResult: {
              message: a.buildResult.message,
              status:
                a.buildResult.status === BuildResultStatus.ERROR
                  ? 'Error'
                  : 'Success',
            },
            attempt: a.attempt,
          })),
          null,
          2
        )}
Serve testing results: ${JSON.stringify(
          app.attemptDetails.map((a) => ({
            serveTestingResult: {
              runtimeErrors: a.serveTestingResult?.runtimeErrors,
            },
          }))
        )}`
    )
    .join('\n------------\n');
}
