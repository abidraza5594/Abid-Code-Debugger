import { config } from '../config.js';
import { mistral } from '../mistral/client.js';
import {
  FixSuggestionSchema,
  RootCauseAnalysisSchema,
  type FixSuggestion,
  type RootCauseAnalysis,
} from '../mistral/schemas.js';
import {
  SYSTEM_FIX,
  SYSTEM_ROOT_CAUSE,
  buildFixUserMessage,
  buildRootCauseUserMessage,
  type FixPromptInput,
  type RootCausePromptInput,
} from '../mistral/prompts.js';

interface ParsedOutput<T> {
  data: T;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
}

export const aiClient = {
  provider(): string {
    return config.ai.provider;
  },

  ready(): boolean {
    if (config.ai.provider === 'heuristic') return false;
    if (config.ai.provider === 'ollama') return true;
    return mistral.ready();
  },

  async rootCause(input: RootCausePromptInput): Promise<ParsedOutput<RootCauseAnalysis>> {
    if (config.ai.provider === 'ollama') {
      return ollamaJson<RootCauseAnalysis>({
        model: config.ollama.rootCauseModel,
        system: SYSTEM_ROOT_CAUSE,
        user: buildRootCauseUserMessage(input),
        validate: (value) => RootCauseAnalysisSchema.parse(value),
      });
    }
    return mistral.rootCause(input);
  },

  async fixPatch(input: FixPromptInput): Promise<ParsedOutput<FixSuggestion>> {
    if (config.ai.provider === 'ollama') {
      return ollamaJson<FixSuggestion>({
        model: config.ollama.fixModel,
        system: SYSTEM_FIX,
        user: buildFixUserMessage(input),
        validate: (value) => FixSuggestionSchema.parse(value),
      });
    }
    return mistral.fixPatch(input);
  },
};

async function ollamaJson<T>(input: {
  model: string;
  system: string;
  user: string;
  validate: (value: unknown) => T;
}): Promise<ParsedOutput<T>> {
  const response = await fetch(`${config.ollama.baseUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      stream: false,
      format: 'json',
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      options: { temperature: 0.1 },
    }),
  });
  if (!response.ok) {
    throw new Error(`Ollama ${response.status}: ${await response.text()}`);
  }
  const payload = (await response.json()) as { message?: { content?: string } };
  const content = payload.message?.content;
  if (!content) throw new Error('Ollama response missing message.content');
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Ollama returned non-JSON content: ${(err as Error).message}`);
  }
  return {
    data: input.validate(parsed),
    model: input.model,
  };
}
