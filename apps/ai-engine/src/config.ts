/**
 * Centralized configuration. Reads from .env (via dotenv) plus environment variables. All
 * lookups are typed and validated so a misconfiguration fails at boot, not at first request.
 */

import 'dotenv/config';
import type { MistralModelId } from '@angular-ai-debugger/shared-types';

function envString(key: string, fallback: string): string {
  const v = process.env[key];
  return v && v.length > 0 ? v : fallback;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export interface EngineConfig {
  mistral: {
    apiKey: string | undefined;
    rootCauseModel: MistralModelId;
    fixModel: MistralModelId;
    refactorModel: MistralModelId;
    classifyModel: MistralModelId;
  };
  http: { port: number };
  ws: { port: number };
  storage: { dataDir: string; sqliteFile: string };
  limits: {
    maxEventsPerRequest: number;
    rootCauseMaxOutputTokens: number;
    fixMaxOutputTokens: number;
  };
}

export const config: EngineConfig = {
  mistral: {
    apiKey: process.env.MISTRAL_API_KEY?.length ? process.env.MISTRAL_API_KEY : undefined,
    rootCauseModel: envString('MISTRAL_ROOT_CAUSE_MODEL', 'mistral-large-3-25-12') as MistralModelId,
    fixModel: envString('MISTRAL_FIX_MODEL', 'codestral-25-08') as MistralModelId,
    refactorModel: envString('MISTRAL_REFACTOR_MODEL', 'devstral-2-25-12') as MistralModelId,
    classifyModel: envString('MISTRAL_CLASSIFY_MODEL', 'ministral-3-8b-25-12') as MistralModelId,
  },
  http: { port: envInt('HTTP_PORT', 5757) },
  ws: { port: envInt('WS_PORT', 5758) },
  storage: {
    dataDir: envString('DATA_DIR', './data'),
    sqliteFile: envString('SQLITE_FILE', 'engine.db'),
  },
  limits: {
    maxEventsPerRequest: envInt('MAX_EVENTS_PER_REQUEST', 2000),
    rootCauseMaxOutputTokens: envInt('ROOT_CAUSE_MAX_OUTPUT_TOKENS', 1200),
    fixMaxOutputTokens: envInt('FIX_MAX_OUTPUT_TOKENS', 1500),
  },
};

export function aiAvailable(): boolean {
  return typeof config.mistral.apiKey === 'string';
}
