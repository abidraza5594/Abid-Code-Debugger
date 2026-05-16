/**
 * Change-detection storm detector. Two signals:
 *   1. ApplicationRef.tick() firing more than `tickThreshold` times per second sustained.
 *   2. A single component appearing in 5x the tick frequency of its peers (re-rendering hot
 *      because of an expensive binding or impure pipe).
 */

import type {
  AnalysisResult,
  Detector,
  EventOf,
} from '@angular-ai-debugger/shared-types';
import { eventsOf } from '@angular-ai-debugger/shared-types';

interface CompStat {
  name: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  seq: number[];
}

const TICK_WINDOW_MS = 2000;
const TICK_THRESHOLD = 60; // ticks per 2s window

export const cdStormDetector: Detector = {
  id: 'cd-storm',
  name: 'Change-detection storm',
  consumes: ['change-detection'],
  setup() {
    /* nothing */
  },
  analyze(events, ctx) {
    const ticks = (ctx.state.get('ticks') as number[] | undefined) ?? [];
    const components = (ctx.state.get('components') as Map<string, CompStat> | undefined) ?? new Map();
    ctx.state.set('ticks', ticks);
    ctx.state.set('components', components);
    const results: AnalysisResult[] = [];

    const cdEvents = eventsOf(events, 'change-detection') as EventOf<'change-detection'>[];
    for (const e of cdEvents) {
      if (e.kind === 'tick') {
        ticks.push(e.pageTime);
        while (ticks.length > 0 && ticks[0]! < e.pageTime - TICK_WINDOW_MS) ticks.shift();
        if (ticks.length >= TICK_THRESHOLD) {
          results.push(stormResult(ticks.length, ticks[0]!, e.pageTime, e.seq));
        }
      } else if (e.kind === 'component' && e.componentName) {
        const stat = components.get(e.componentName) ?? {
          name: e.componentName,
          count: 0,
          firstSeen: e.pageTime,
          lastSeen: e.pageTime,
          seq: [],
        };
        stat.count += 1;
        stat.lastSeen = e.pageTime;
        stat.seq.push(e.seq);
        components.set(e.componentName, stat);
      }
    }

    // Hot-component finding: any component whose count is >5x the median for this session.
    if (components.size >= 3) {
      const counts = Array.from(components.values()).map((c) => c.count).sort((a, b) => a - b);
      const median = counts[Math.floor(counts.length / 2)] ?? 1;
      for (const stat of components.values()) {
        if (stat.count >= Math.max(20, median * 5)) {
          results.push(hotComponentResult(stat, median));
        }
      }
    }

    return dedupe(results);
  },
  finalize: () => [],
  cleanup() {
    /* nothing */
  },
};

function stormResult(count: number, fromMs: number, toMs: number, latestSeq: number): AnalysisResult {
  return {
    id: 'cd-storm:global',
    detectorId: 'cd-storm',
    category: 'change-detection-storm',
    severity: count > 200 ? 'critical' : count > 100 ? 'high' : 'medium',
    title: 'Change-detection storm',
    summary: `${count} ApplicationRef.tick() calls in the last ${(toMs - fromMs).toFixed(0)}ms.`,
    detail:
      'A sustained rate of tick() this high usually means an Observable in a template or a non-Zone-aware async work item is dirtying the tree on every microtask. Inspect templates that call methods directly (e.g. {{ getter() }}) and replace with signals or async pipe.',
    confidence: 0.8,
    occurrences: count,
    firstSeenMs: fromMs,
    lastSeenMs: toMs,
    locations: [],
    evidenceEventSeq: [latestSeq],
    tags: ['angular', 'change-detection'],
  };
}

function hotComponentResult(stat: CompStat, median: number): AnalysisResult {
  return {
    id: `cd-hot:${stat.name}`,
    detectorId: 'cd-storm',
    category: 'expensive-template',
    severity: stat.count > 500 ? 'high' : 'medium',
    title: `${stat.name} re-rendering ${stat.count}x (median ${median})`,
    summary: `Component renders ${stat.count} times — more than 5x median. Suspect expensive binding or missing OnPush.`,
    detail:
      'Likely causes: (1) a template binding calls a method that allocates; (2) an *ngFor without trackBy; (3) ChangeDetectionStrategy is Default but the component sees frequent input churn. Mistral will inspect template + class.',
    confidence: 0.75,
    occurrences: stat.count,
    firstSeenMs: stat.firstSeen,
    lastSeenMs: stat.lastSeen,
    locations: [{ file: '', symbol: stat.name }],
    evidenceEventSeq: stat.seq.slice(-10),
    tags: ['angular', 'change-detection', 'component'],
  };
}

function dedupe(arr: AnalysisResult[]): AnalysisResult[] {
  const out = new Map<string, AnalysisResult>();
  for (const r of arr) out.set(r.id, r);
  return Array.from(out.values());
}
