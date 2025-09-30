import {z} from 'zod';
import {LlmResponseFile, Usage} from '../shared-interfaces.js';
import {GenkitRunner} from '../codegen/genkit/genkit-runner.js';
import {UserFacingError} from '../utils/errors.js';

// NOTE: When changing this, also change `browser-agent`'s prompt!
const USER_JOURNEY_SCHEMA = z.object({
  name: z.string().describe('Name of the user journey'),
  steps: z
    .array(z.string().describe('Description of a user journey step.'))
    .describe('Sequence of steps to test the user journey.'),
});

const USE_JOURNEY_ARRAY_SCHEMA = z.array(USER_JOURNEY_SCHEMA);

/** Type defining a user journey for an app. */
export type UserJourneyDefinition = z.infer<typeof USER_JOURNEY_SCHEMA>;

/** Result of generating user journeys. */
export interface UserJourneysResult {
  /** The generated user journeys. */
  result: UserJourneyDefinition[];
  /** Token usage for generating the user journeys. */
  usage: Usage;
}

export async function generateUserJourneysForApp(
  llm: GenkitRunner,
  appName: string,
  appPrompt: string,
  appFiles: LlmResponseFile[],
  abortSignal: AbortSignal,
): Promise<UserJourneysResult> {
  const result = await llm.generateConstrained({
    prompt: `
As a highly-skilled Software Quality Assurance (QA) engineer and UI/UX expert, you are tasked with performing end-to-end (E2E) quality evaluation of a web application.
Your primary task is to derive User Journeys from a user prompt that generates a web application and the generated source files.

## Task guidance
  - Carefully read and analyze the provided original prompt and the application's source code.
  - Identify User Journeys that the application is supposed to support.
    * A User Journey is a complete, multi-step workflow that a user would perform.
  - Return a minimal set of primary user journeys.
    * We do not want to have super complicated verification of user journeys, or a too comprehensive verification. This out of scope and too slow!

## Example

**App prompt**
\`\`\`
Create a modern, single-page web application that allows users to find recipes based on ingredients they have at hand.
\`\`\`

**Expected output**
\`\`\`
[
  {
    "name": "Search for recipes with valid ingredients",
    "steps": [
      "Navigate to the application URL.",
      "Verify that the ingredient input field is visible.",
      "Enter a comma-separated list of valid ingredients (e.g., 'chicken, tomatoes, pasta') into the input field.",
      "Click the 'Search' button.",
      "Verify that a loading indicator appears and then disappears.",
      "Verify that a list of recipes is displayed with names, images, and descriptions."
    ]
  },
  {
    "name": "Handle a search with no results",
    "steps": [
      "Navigate to the application URL.",
      "Enter a list of ingredients that are unlikely to yield a recipe (e.g., 'rocks, sand, paper').",
      "Click the 'Search' button.",
      "Verify that a 'No results found' message is displayed.",
      "Verify that no recipe cards are rendered."
    ]
  },
  {
    "name": "Handle empty search query",
    "steps": [
      "Navigate to the application URL.",
      "Ensure the ingredient input field is empty.",
      "Click the 'Search' button.",
      "Verify that no search is performed.",
      "Verify that an error message (e.g., 'Please enter at least one ingredient') is displayed or the search button is disabled."
    ]
  },
  {
    "name": "Clear the search results",
    "steps": [
      "Perform a successful search that displays a list of recipes.",
      "Clear the text from the ingredient input field.",
      "Verify that the displayed recipe list disappears.",
      "Verify that the UI returns to its initial state, ready for a new search."
    ]
  }
]
\`\`\`
`,
    schema: USE_JOURNEY_ARRAY_SCHEMA,
    model: 'gemini-2.5-flash',
    skipMcp: true,
    messages: [
      {
        role: 'user',
        content: [{text: `Below is the user's prompt:\n\n${appPrompt}`}],
      },
      {
        role: 'user',
        content: [
          {
            text: `Below is the source code of an app generated for the above prompt:\n\n${appFiles
              .map(file => `${file.filePath}:\n\`\`\`\n${file.code}\`\`\``)
              .join('\n\n')}`,
          },
        ],
      },
    ],
    timeout: {
      description: `Computing user journeys for ${appName}`,
      durationInMins: 3,
    },
    abortSignal,
  });

  if (result.output === null) {
    throw new UserFacingError(`Could not determine journeys for ${appName}`);
  }

  return {
    usage: {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      totalTokens: result.usage?.totalTokens ?? 0,
    },
    result: result.output,
  };
}
