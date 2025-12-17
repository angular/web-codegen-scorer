import {GenkitRunner} from '../codegen/genkit/genkit-runner.js';
import {DEFAULT_SUMMARY_MODEL} from '../configuration/constants.js';
import {AssessmentResult, ReportContextFilter, RatingContextFilter} from '../shared-interfaces.js';
import {chatWithReportAI} from './report-ai-chat.js';

export async function summarizeReportWithAI(
  llm: GenkitRunner,
  abortSignal: AbortSignal,
  assessments: AssessmentResult[],
) {
  const model = DEFAULT_SUMMARY_MODEL;

  if (!llm.getSupportedModels().includes(model)) {
    throw new Error(`Unable to generate AI summary due to unsupported model: ${model}`);
  }

  return chatWithReportAI(
    llm,
    `Strictly follow the instructions here.

- You will receive a report of an evaluation tool that describes LLM-generated code quality. Summarize/categorize the report.
- Quote exact build failures, or assessment checks when possible.
- Try to keep the summary short. e.g. cut off app names to reduce output length.
- Do not add an overview of scores unless necessary to illustrate common failures or low-hanging fruit.

**Your primary goals (two)**:
  - Make it easy to understand what common failures are,
  - Make it easy to identify low-hanging fruit that we can fix to improve code generation for LLMs.

--
Categorize the failures and provide a brief summary of the report. Keep it short but insightful!`,
    abortSignal,
    assessments,
    [],
    // For AI summaries we use lite model as it's faster and cheaper (+ reduces rate limiting)
    model,
    {
      reportContextFilter: ReportContextFilter.NonPerfectReports,
      ratingContextFilter: RatingContextFilter.NonPerfectRatings,
    },
    undefined,
  );
}
