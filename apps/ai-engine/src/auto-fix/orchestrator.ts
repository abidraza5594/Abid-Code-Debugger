/**
 * Glue between Mistral fix suggestions (codestral-25-08) and the local ts-morph rules. Strategy:
 *
 *   1. Try the deterministic ts-morph rules first. If they produce a diff, that is the safe-fix
 *      path and we mark autoApplicable=true.
 *   2. If the rules can't make changes, fall back to Mistral codestral-25-08, which can produce
 *      a more general diff but is marked autoApplicable=false until the engineer reviews it.
 *
 * The orchestrator does NOT write files. The DevTools panel asks for the patch, the engineer
 * reviews, and the user explicitly opts in to write.
 */

import type {
  AiFixSuggestion,
  AnalysisResult,
} from '@angular-ai-debugger/shared-types';
import { aiAvailable } from '../config.js';
import { mistral } from '../mistral/client.js';
import { store } from '../storage/sqlite.js';
import { runFixes } from './engine.js';
import { existsSync, readFileSync } from 'node:fs';

type Log = (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;

export class FixOrchestrator {
  constructor(private readonly deps: { log: Log }) {}

  async suggestFor(sessionId: string, analysisId: string): Promise<AiFixSuggestion | undefined> {
    const { analyses, session } = store.loadSession(sessionId);
    const analysis = analyses.find((a) => a.id === analysisId);
    if (!analysis || !session) return undefined;
    const result = session.results.find((r) => r.id === analysis.resultId);
    if (!result) return undefined;

    const filePath = pickFilePath(result);
    const tsMorphAttempt = filePath
      ? runFixes({
          category: result.category,
          filePath,
          symbols: result.locations.map((l) => l.symbol ?? '').filter(Boolean),
        })
      : { ruleResults: [], changed: false };

    if (tsMorphAttempt.changed) {
      const diffs = tsMorphAttempt.ruleResults.filter((r) => r.modified).map((r) => r.diff);
      const ruleIds = tsMorphAttempt.ruleResults.filter((r) => r.modified).map((r) => r.ruleId).join(', ');
      return {
        id: `fix:${analysisId}`,
        analysisId,
        model: 'ts-morph',
        title: `Auto-fix via ${ruleIds}`,
        body: `Applied deterministic rules: ${ruleIds}.\n\n\`\`\`diff\n${diffs.join('\n')}\n\`\`\``,
        autoApplicable: true,
        autoApplicableReason: 'Produced by ts-morph rules with no AI generation. Apply with `git apply`.',
      };
    }

    if (!aiAvailable() || !mistral.ready()) {
      return {
        id: `fix:${analysisId}`,
        analysisId,
        model: 'ts-morph',
        title: 'No safe auto-fix available',
        body:
          'No deterministic rule matched, and no Mistral key is configured for code generation. Recommended actions remain in the AI analysis.',
        autoApplicable: false,
        autoApplicableReason: 'No AI generation available offline.',
      };
    }

    const source = filePath && existsSync(filePath)
      ? [{ path: filePath, content: readFileSync(filePath, 'utf8') }]
      : [];

    try {
      const { data, model } = await mistral.fixPatch({
        analysisHeadline: analysis.headline,
        rootCause: analysis.rootCause,
        recommendedActions: analysis.recommendedActions,
        affectedLocations: result.locations.map((l) => `${l.file}${l.line ? `:${l.line}` : ''}${l.symbol ? ` (${l.symbol})` : ''}`),
        source,
      });
      return {
        id: `fix:${analysisId}`,
        analysisId,
        model,
        title: data.title,
        body: data.body,
        autoApplicable: data.autoApplicable && data.diff.length > 0,
        autoApplicableReason: data.autoApplicableReason,
      };
    } catch (err) {
      this.deps.log('warn', 'mistral fixPatch failed', err);
      return {
        id: `fix:${analysisId}`,
        analysisId,
        model: 'ts-morph',
        title: 'Auto-fix generation failed',
        body: `An error occurred contacting Mistral: ${(err as Error).message}`,
        autoApplicable: false,
        autoApplicableReason: 'Generation error.',
      };
    }
  }
}

function pickFilePath(result: AnalysisResult): string | undefined {
  for (const loc of result.locations) {
    if (loc.file && loc.file.endsWith('.ts')) return loc.file;
  }
  return undefined;
}
