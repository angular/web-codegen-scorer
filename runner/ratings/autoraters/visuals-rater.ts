import { z } from 'zod';
import { PromptDataMessage } from '../../codegen/llm-runner.js';
import {
  AutoRateResult,
  getCoefficient,
  MAX_RATING,
} from './auto-rate-shared.js';
import { GenkitRunner } from '../../codegen/genkit/genkit-runner.js';
import defaultVisualRaterPrompt from './visual-rating-prompt.js';
import { Environment } from '../../configuration/environment.js';
import { screenshotUrlToPngBuffer } from '../../utils/screenshots.js';

/**
 * Automatically rate the appearance of a screenshot using an LLM.
 * @param llm LLM runner to use for the rating.
 * @param abortSignal Signal to fire when the rating should be aborted.
 * @param model Model to use for the rating.
 * @param environment Environment in which the rating is running.
 * @param appPrompt Prompt to be used for the rating.
 * @param screenshotPngUrl Screenshot PNG URL to be rated.
 * @param label Label for the rating, used for logging.
 */
export async function autoRateAppearance(
  llm: GenkitRunner,
  abortSignal: AbortSignal,
  model: string,
  environment: Environment,
  appPrompt: string,
  screenshotPngUrl: string,
  label: string
): Promise<AutoRateResult> {
  const prompt = environment.renderPrompt(defaultVisualRaterPrompt, null, {
    APP_PROMPT: appPrompt,
  });

  const messages: PromptDataMessage[] = [
    {
      role: 'user',
      content: [
        {
          media: {
            base64PngImage: (
              await screenshotUrlToPngBuffer(screenshotPngUrl)
            ).toString('base64'),
            url: screenshotPngUrl,
          },
        },
      ],
    },
  ];

  const result = await llm.generateConstrained({
    abortSignal,
    messages,
    prompt,
    model,
    skipMcp: true,
    timeout: {
      description: `Rating screenshot of ${label} using ${model}`,
      durationInMins: 2.5,
    },
    schema: z.object({
      rating: z
        .number()
        .describe(`Rating from 1-${MAX_RATING}. Best is ${MAX_RATING}.`),
      summary: z
        .string()
        .describe(
          'Summary of the overall app, talking about concrete features, super concise.'
        ),
      categories: z.array(
        z.object({
          name: z.string().describe('Category name'),
          message: z.string().describe('Short description of what is missing.'),
        })
      ),
    }),
  });

  const output = result.output!;

  return {
    coefficient: getCoefficient(output.rating),
    usage: {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      totalTokens: result.usage?.totalTokens ?? 0,
    },
    details: output,
  };
}
