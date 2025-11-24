import type {LanguageModelV2Middleware} from '@ai-sdk/provider';

/**
 * Middleware for Anthropic AI SDK models that is necessary for enabling
 * thinking mode + structured responses.
 *
 * This is necessary because Anthropic would be used with enforced tool usage
 * by default with `generateObject()`. This is a workaround that makes the tool
 * optional: https://github.com/vercel/ai/issues/9351.
 */
export const anthropicThinkingWithStructuredResponseMiddleware: LanguageModelV2Middleware = {
  transformParams: ({params}) => {
    if (params.responseFormat?.type === 'json' && params.responseFormat.schema) {
      params.tools = [
        {
          type: 'function',
          description: 'Respond with a JSON object for the structured output/answer.',
          inputSchema: params.responseFormat.schema,
          name: 'json',
        },
      ];
      params.toolChoice = {type: 'auto'};
      params.responseFormat = {type: 'text'};
      params.prompt.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Use the `json` tool to provide the structured output/answer. No other text is needed.',
          },
        ],
      });
    }
    return Promise.resolve(params);
  },
  wrapGenerate: async ({doGenerate}) => {
    const result = await doGenerate();

    // Extract the JSON tool call (conforming to the schema) and return it as text response.
    for (const r of result.content) {
      if (r.type === 'tool-call' && r.toolName === 'json') {
        result.content.push({type: 'text', text: r.input});
      }
    }

    return result;
  },
};
