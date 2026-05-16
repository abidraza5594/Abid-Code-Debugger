/**
 * Slow API detector. Treats any request taking longer than a configurable threshold as a
 * candidate. We bucket by URL pattern (path with numeric ids replaced by `:id`) so multiple
 * slow calls to the same endpoint collapse into one finding.
 */

import type {
  AnalysisResult,
  CapturedEvent,
  Detector,
  DetectorContext,
} from '@angular-ai-debugger/shared-types';
import { eventsOf } from '@angular-ai-debugger/shared-types';

const SLOW_MS = 1500;
const SEVERE_MS = 4000;

interface Bucket {
  pattern: string;
  count: number;
  totalMs: number;
  maxMs: number;
  examples: string[];
  firstSeen: number;
  lastSeen: number;
  seq: number[];
}

export const slowApiDetector: Detector = {
  id: 'slow-api',
  name: 'Slow API requests',
  consumes: ['fetch', 'xhr'],
  setup() {
    /* nothing */
  },
  analyze(events, ctx) {
    const buckets = (ctx.state.get('buckets') as Map<string, Bucket> | undefined) ?? new Map();
    ctx.state.set('buckets', buckets);
    const results: AnalysisResult[] = [];
    for (const e of [...eventsOf(events, 'fetch'), ...eventsOf(events, 'xhr')]) {
      if (e.kind !== 'response') continue;
      if (e.durationMs === undefined || e.durationMs < SLOW_MS) continue;
      const pattern = patternize(e.url);
      const b = buckets.get(pattern) ?? {
        pattern,
        count: 0,
        totalMs: 0,
        maxMs: 0,
        examples: [],
        firstSeen: e.pageTime,
        lastSeen: e.pageTime,
        seq: [],
      };
      b.count += 1;
      b.totalMs += e.durationMs;
      b.maxMs = Math.max(b.maxMs, e.durationMs);
      b.lastSeen = e.pageTime;
      b.seq.push(e.seq);
      if (b.examples.length < 3) b.examples.push(`${e.method} ${e.url}`);
      buckets.set(pattern, b);
      results.push(toResult(b));
    }
    return dedupeById(results);
  },
  finalize: () => [],
  cleanup() {
    /* nothing */
  },
};

function patternize(url: string): string {
  try {
    const u = new URL(url, 'http://_/');
    const path = u.pathname.replace(/\b\d+\b/g, ':id').replace(/\b[0-9a-f-]{8,}\b/gi, ':id');
    return `${u.host}${path}`;
  } catch {
    return url;
  }
}

function toResult(b: Bucket): AnalysisResult {
  const avg = b.totalMs / b.count;
  const severity = b.maxMs >= SEVERE_MS ? 'high' : avg >= SLOW_MS ? 'medium' : 'low';
  return {
    id: `slow-api:${b.pattern}`,
    detectorId: 'slow-api',
    category: 'slow-api',
    severity,
    title: `Slow endpoint ${b.pattern}`,
    summary: `${b.count} call(s); avg ${Math.round(avg)}ms, max ${Math.round(b.maxMs)}ms.`,
    detail: `Recent samples:\n${b.examples.join('\n')}`,
    confidence: 0.9,
    occurrences: b.count,
    firstSeenMs: b.firstSeen,
    lastSeenMs: b.lastSeen,
    locations: [],
    evidenceEventSeq: b.seq.slice(-10),
    tags: ['network', 'latency'],
  };
}

function dedupeById(results: AnalysisResult[]): AnalysisResult[] {
  const out = new Map<string, AnalysisResult>();
  for (const r of results) out.set(r.id, r);
  return Array.from(out.values());
}

function _ctxUnused(_: CapturedEvent[], __: DetectorContext): void {
  // type pinning helper
}
void _ctxUnused;
