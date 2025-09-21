import { GeminiModelProvider } from './providers/gemini.js';
import { ClaudeModelProvider } from './providers/claude.js';
import { OpenAiModelProvider } from './providers/open-ai.js';
import { GrokModelProvider } from './providers/grok.js';

export const MODEL_PROVIDERS = [
  new GeminiModelProvider(),
  new ClaudeModelProvider(),
  new OpenAiModelProvider(),
  new GrokModelProvider(),
];
