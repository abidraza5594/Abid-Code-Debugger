/**
 * Thin wrapper around `@mistralai/mistralai`. Exposes three task-specific entry points
 * (rootCause, fixPatch, classifyNoise) and routes each to the configured model.
 *
 * Uses `client.chat.parse(...)` for structured outputs (Zod schemas → JSON Schema). Falls back
 * to `chat.complete(...)` with json_object format if parse rejects (e.g. older models without
 * structured output support).
 *
 * Retry / rate-limit handling is delegated to the SDK's built-in retryConfig.
 */

import { Mistral } from '@mistralai/mistralai';
import type { MistralModelId } from '@angular-ai-debugger/shared-types';
import { config } from '../config.js';
import {
  ClassifyNoiseSchema,
  FixSuggestionSchema,
  RootCauseAnalysisSchema,
  type ClassifyNoise,
  type FixSuggestion,
  type RootCauseAnalysis,
} from './schemas.js';
import {
  SYSTEM_CLASSIFY,
  SYSTEM_FIX,
  SYSTEM_ROOT_CAUSE,
  buildClassifyUserMessage,
  buildFixUserMessage,
  buildRootCauseUserMessage,
  type FixPromptInput,
  type RootCausePromptInput,
} from './prompts.js';

interface ParsedOutput<T> {
  data: T;
  model: MistralModelId;
  promptTokens?: number;
  completionTokens?: number;
}

class MistralEngineClient {
  private readonly client: Mistral | undefined;
  constructor(apiKey: string | undefined) {
    if (!apiKey) {
      this.client = undefined;
      return;
    }
    this.client = new Mistral({
      apiKey,
      retryConfig: {
        strategy: 'backoff',
        backoff: { initialInterval: 500, maxInterval: 6000, exponent: 2, maxElapsedTime: 30_000 },
        retryConnectionErrors: true,
      },
    });
  }

  ready(): boolean {
    return !!this.client;
  }

  async rootCause(input: RootCausePromptInput): Promise<ParsedOutput<RootCauseAnalysis>> {
    if (!this.client) throw new Error('Mistral client not configured');
    const model = config.mistral.rootCauseModel;
    const response = await this.client.chat.parse({
      model,
      maxTokens: config.limits.rootCauseMaxOutputTokens,
      responseFormat: RootCauseAnalysisSchema,
      messages: [
        { role: 'system', content: SYSTEM_ROOT_CAUSE },
        { role: 'user', content: buildRootCauseUserMessage(input) },
      ],
    });
    return extract(response, model);
  }

  async fixPatch(input: FixPromptInput): Promise<ParsedOutput<FixSuggestion>> {
    if (!this.client) throw new Error('Mistral client not configured');
    const model = config.mistral.fixModel;
    const response = await this.client.chat.parse({
      model,
      maxTokens: config.limits.fixMaxOutputTokens,
      responseFormat: FixSuggestionSchema,
      messages: [
        { role: 'system', content: SYSTEM_FIX },
        { role: 'user', content: buildFixUserMessage(input) },
      ],
    });
    return extract(response, model);
  }

  async classifyNoise(event: { source: string; summary: string }): Promise<ParsedOutput<ClassifyNoise>> {
    if (!this.client) throw new Error('Mistral client not configured');
    const model = config.mistral.classifyModel;
    const response = await this.client.chat.parse({
      model,
      maxTokens: 80,
      responseFormat: ClassifyNoiseSchema,
      messages: [
        { role: 'system', content: SYSTEM_CLASSIFY },
        { role: 'user', content: buildClassifyUserMessage(event) },
      ],
    });
    return extract(response, model);
  }
}

interface ExtractableResponse<T> {
  choices?: Array<{ message?: { parsed?: T; content?: unknown } }>;
  usage?: { promptTokens?: number; completionTokens?: number };
}

function extract<T>(response: ExtractableResponse<T>, model: MistralModelId): ParsedOutput<T> {
  const first = response.choices?.[0]?.message;
  if (!first) throw new Error('Mistral response missing choices[0].message');
  let parsed = first.parsed;
  if (parsed === undefined && typeof first.content === 'string') {
    // Some intermediate SDK versions return only `content`. Try to JSON.parse as a fallback.
    try {
      parsed = JSON.parse(first.content) as T;
    } catch {
      throw new Error('Mistral returned non-JSON content for a parse() request');
    }
  }
  if (parsed === undefined) throw new Error('Mistral response missing parsed payload');
  return {
    data: parsed,
    model,
    ...(response.usage?.promptTokens !== undefined
      ? { promptTokens: response.usage.promptTokens }
      : {}),
    ...(response.usage?.completionTokens !== undefined
      ? { completionTokens: response.usage.completionTokens }
      : {}),
  };
}

export const mistral = new MistralEngineClient(config.mistral.apiKey);
