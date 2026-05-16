/**
 * RxJS subscription-leak detector. Reads `rxjs` events and scores subscriptions by:
 *   - liveMs at leak-suspect time
 *   - stack heuristics (subscriptions inside ngOnInit / constructor without takeUntilDestroyed)
 */

import type { AnalysisResult, Detector } from '@angular-ai-debugger/shared-types';
import { eventsOf } from '@angular-ai-debugger/shared-types';

interface Suspect {
  id: number;
  liveMs: number;
  stack: string;
  componentHint: string;
  firstSeen: number;
  lastSeen: number;
  seq: number[];
}

export const rxjsLeakDetector: Detector = {
  id: 'rxjs-leak',
  name: 'RxJS subscription leaks',
  consumes: ['rxjs'],
  setup() {
    /* nothing */
  },
  analyze(events, ctx) {
    const suspects = (ctx.state.get('suspects') as Map<number, Suspect> | undefined) ?? new Map();
    ctx.state.set('suspects', suspects);
    const results: AnalysisResult[] = [];

    for (const e of eventsOf(events, 'rxjs')) {
      if (e.kind === 'unsubscribe' || e.kind === 'complete') {
        suspects.delete(e.subscriptionId);
        continue;
      }
      if (e.kind !== 'leak-suspect') continue;
      const stack = e.createdAtStack ?? '';
      const componentHint = guessComponent(stack) ?? '(unknown)';
      const prev = suspects.get(e.subscriptionId);
      const next: Suspect = {
        id: e.subscriptionId,
        liveMs: e.liveMs ?? 0,
        stack,
        componentHint,
        firstSeen: prev?.firstSeen ?? e.pageTime,
        lastSeen: e.pageTime,
        seq: prev ? [...prev.seq, e.seq] : [e.seq],
      };
      suspects.set(e.subscriptionId, next);
    }

    if (suspects.size === 0) return [];

    // Group suspects by componentHint so a 10-leak component shows as one finding.
    const byComponent = new Map<string, Suspect[]>();
    for (const s of suspects.values()) {
      const arr = byComponent.get(s.componentHint) ?? [];
      arr.push(s);
      byComponent.set(s.componentHint, arr);
    }
    for (const [component, group] of byComponent) {
      results.push(buildResult(component, group));
    }
    return results;
  },
  finalize: () => [],
  cleanup() {
    /* nothing */
  },
};

function buildResult(component: string, group: Suspect[]): AnalysisResult {
  const maxLive = Math.max(...group.map((g) => g.liveMs));
  const sample = group[0]!.stack;
  return {
    id: `rxjs-leak:${component}`,
    detectorId: 'rxjs-leak',
    category: 'rxjs-leak',
    severity: group.length > 5 || maxLive > 120_000 ? 'high' : 'medium',
    title: `Potential RxJS leak in ${component}`,
    summary: `${group.length} subscription(s) live for >30s without unsubscribing (max ${(maxLive / 1000).toFixed(1)}s).`,
    detail: `Sample subscription stack:\n${sample}`,
    confidence: 0.7,
    occurrences: group.length,
    firstSeenMs: Math.min(...group.map((g) => g.firstSeen)),
    lastSeenMs: Math.max(...group.map((g) => g.lastSeen)),
    locations: [{ file: '', symbol: component }],
    evidenceEventSeq: group.flatMap((g) => g.seq).slice(-10),
    tags: ['rxjs', 'memory'],
  };
}

function guessComponent(stack: string): string | undefined {
  const re = /at\s+(?:new\s+)?([A-Z][\w$]*?(?:Component|Service|Directive|Pipe|Guard|Resolver|Interceptor))\b/;
  for (const line of stack.split('\n')) {
    const m = re.exec(line);
    if (m) return m[1];
  }
  return undefined;
}
