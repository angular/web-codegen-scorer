import type {LanguageModelV3Middleware} from '@ai-sdk/provider';

/**
 * Middleware for Anthropic AI SDK models that is necessary for enabling
 * thinking mode + structured responses.
 *
 * This is necessary because Anthropic would be used with enforced tool usage
 * by default with `generateText()`. This is a workaround that makes the tool
 * optional: https://github.com/vercel/ai/issues/9351, https://github.com/vercel/ai/issues/11227.
 */
export const anthropicThinkingWithStructuredResponseMiddleware: LanguageModelV3Middleware = {
  specificationVersion: 'v3',
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

    // Anthropic's Thinking mode cannot be used with forced tool calls. To work around this,
    // we use `toolChoice: 'auto'` in the `transformParams` above. However, this causes
    // the model to return a `finishReason` of `tool-calls` instead of `stop`.
    //
    // The Vercel AI SDK's high-level `generateText` (and `generateObject`) logic is strict:
    // it only attempts to parse structured output if the `finishReason` is exactly `stop`.
    // If it sees `tool-calls`, it assumes the conversation is ongoing (waiting for tool
    // execution) and returns an empty output, which triggers `AI_NoOutputGeneratedError`.
    //
    // This fixes this by:
    // 1. Finding the optional 'json' tool call.
    // 2. Extracting its raw JSON input and injecting it as a standard text response.
    // 3. Manually overriding the `finishReason` to `stop`.
    // 4. Removing the tool call metadata so the SDK doesn't expect a tool result.
    const newContent: typeof result.content = [];
    let jsonToolCallFound = false;

    for (const r of result.content) {
      if (r.type === 'tool-call' && r.toolName === 'json') {
        newContent.push({type: 'text', text: r.input});
        jsonToolCallFound = true;
      } else {
        newContent.push(r);
      }
    }

    if (jsonToolCallFound) {
      result.content = newContent;

      // We override the finish reason to 'stop' to allow the AI SDK to parse the
      // text content as a structured object.
      result.finishReason = {
        unified: 'stop',
        raw: result.finishReason.raw,
      };
    }

    return result;
  },
};
