import {GenkitRunner} from '../codegen/genkit/genkit-runner.js';
import {AssessmentResult} from '../shared-interfaces.js';
import {chatWithReportAI} from './report-ai-chat.js';

export async function summarizeReportWithAI(
  llm: GenkitRunner,
  abortSignal: AbortSignal,
  assessments: AssessmentResult[],
) {
  return chatWithReportAI(
    llm,
    `Strictly follow the instructions here.

- You are an expert in LLM-based code generation evaluation and quality assessments.
- You will receive a report of an evaluation tool that describes LLM-generated code quality. Summarize/categorize the report.
- Quote exact build failures, or assessment checks when possible.
- Try to keep the summary short. e.g. cut off app names to reduce output length.
- Return aesthetically pleasing Markdown for the report. You can use inline styles for colors.

**Your primary goals (two)**:
  - Make it easy to understand what common failures are,
  - Make it easy to identify low-hanging fruit that we can fix to improve code generation for LLMs.

--
Categorize the failures and provide a brief summary of the report. Keep it short but insightful!`,
    abortSignal,
    assessments,
    [],
    // For AI summaries we use lite model as it's faster and cheaper (+ reduces rate limiting)
    'gemini-2.5-flash-lite',
  );
}
