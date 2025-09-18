import { GeminiModelProvider } from './providers/gemini.js';
import { ClaudeModelProvider } from './providers/claude.js';
import { OpenAiModelProvider } from './providers/open-ai.js';
import { OllamaModelProvider } from './providers/ollama.js';
import { GenkitModelProvider } from './model-provider.js';

export const MODEL_PROVIDERS: GenkitModelProvider[] = [
  new GeminiModelProvider(),
  new ClaudeModelProvider(),
  new OpenAiModelProvider(),
  new OllamaModelProvider(),
];
