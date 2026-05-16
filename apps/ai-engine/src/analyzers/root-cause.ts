/**
 * Root-cause analyzer. Given a detector AnalysisResult and the session's events, calls the
 * configured Mistral model (mistral-large-3-25-12 by default). Falls back to the heuristic
 * analyzer when Mistral isn't configured or the call fails.
 */

import type {
  AiAnalysis,
  AnalysisResult,
  CapturedEvent,
} from '@angular-ai-debugger/shared-types';
import { aiAvailable } from '../config.js';
import { mistral } from '../mistral/client.js';
import { buildEvidenceText } from './evidence.js';
import { heuristicAnalysis } from './heuristic-fallback.js';

export interface RootCauseDeps {
  log: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;
}

export class RootCauseAnalyzer {
  constructor(private readonly deps: RootCauseDeps) {}

  async analyze(result: AnalysisResult, events: CapturedEvent[]): Promise<AiAnalysis> {
    if (!aiAvailable() || !mistral.ready()) {
      return heuristicAnalysis(result);
    }
    const evidence = buildEvidenceText(result, events);
    try {
      const { data, model, promptTokens, completionTokens } = await mistral.rootCause({
        result,
        evidenceText: evidence,
      });
      return {
        id: `mistral:${result.id}:${Date.now().toString(36)}`,
        resultId: result.id,
        task: 'root-cause',
        model,
        severity: result.severity,
        headline: data.headline,
        rootCause: data.rootCause,
        explanation: data.explanation,
        recommendedActions: data.recommendedActions,
        affectedLocations: data.affectedLocations.map((l) => ({
          file: l.file,
          ...(l.line ? { line: l.line } : {}),
          ...(l.column ? { column: l.column } : {}),
          ...(l.symbol ? { symbol: l.symbol } : {}),
        })),
        estimatedEffort: data.estimatedEffort,
        confidence: data.confidence,
        generatedAt: Date.now(),
        ...(promptTokens !== undefined ? { promptTokens } : {}),
        ...(completionTokens !== undefined ? { completionTokens } : {}),
      };
    } catch (err) {
      this.deps.log('warn', `Mistral root-cause failed; using heuristic fallback`, err);
      return heuristicAnalysis(result);
    }
  }
}
