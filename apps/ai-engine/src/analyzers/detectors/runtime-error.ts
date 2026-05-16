/**
 * Runtime error / unhandled rejection detector. Buckets identical errors by message + top frame
 * so flapping doesn't create N results.
 */

import type {
  AnalysisResult,
  Detector,
  SourceLocation,
} from '@angular-ai-debugger/shared-types';
import { eventsOf } from '@angular-ai-debugger/shared-types';

interface Bucket {
  message: string;
  topFrame: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  seq: number[];
  stack?: string;
  componentHint?: string;
  isRejection: boolean;
}

export const runtimeErrorDetector: Detector = {
  id: 'runtime-error',
  name: 'Runtime errors & rejections',
  consumes: ['error', 'rejection', 'console'],
  setup() {
    /* nothing */
  },
  analyze(events, ctx) {
    const buckets = (ctx.state.get('buckets') as Map<string, Bucket> | undefined) ?? new Map();
    ctx.state.set('buckets', buckets);
    const results: AnalysisResult[] = [];

    for (const e of eventsOf(events, 'error')) {
      const top = topFrame(e.stack);
      const key = `err:${e.message}|${top}`;
      const b = buckets.get(key) ?? makeBucket(e.message, top, e.pageTime, false);
      b.count += 1;
      b.lastSeen = e.pageTime;
      b.seq.push(e.seq);
      if (!b.stack && e.stack) b.stack = e.stack;
      if (!b.componentHint && e.componentHint) b.componentHint = e.componentHint;
      buckets.set(key, b);
      results.push(toResult(b));
    }
    for (const e of eventsOf(events, 'rejection')) {
      const top = topFrame(e.stack);
      const key = `rej:${e.reason}|${top}`;
      const b = buckets.get(key) ?? makeBucket(e.reason, top, e.pageTime, true);
      b.count += 1;
      b.lastSeen = e.pageTime;
      b.seq.push(e.seq);
      if (!b.stack && e.stack) b.stack = e.stack;
      if (!b.componentHint && e.origin) b.componentHint = e.origin;
      buckets.set(key, b);
      results.push(toResult(b));
    }
    for (const e of eventsOf(events, 'console')) {
      if (e.level !== 'error') continue;
      const msg = e.args.join(' ');
      const top = topFrame(e.stack);
      const key = `cerr:${msg}|${top}`;
      const b = buckets.get(key) ?? makeBucket(msg, top, e.pageTime, false);
      b.count += 1;
      b.lastSeen = e.pageTime;
      b.seq.push(e.seq);
      if (!b.stack && e.stack) b.stack = e.stack;
      buckets.set(key, b);
      results.push(toResult(b));
    }

    return dedupe(results);
  },
  finalize: () => [],
  cleanup() {
    /* nothing */
  },
};

function makeBucket(message: string, topFrame: string, when: number, isRejection: boolean): Bucket {
  return {
    message,
    topFrame,
    count: 0,
    firstSeen: when,
    lastSeen: when,
    seq: [],
    isRejection,
  };
}

function topFrame(stack: string | undefined): string {
  if (!stack) return '';
  const line = stack.split('\n').find((l) => l.includes('at ')) ?? stack.split('\n')[0] ?? '';
  return line.trim().slice(0, 200);
}

function toResult(b: Bucket): AnalysisResult {
  const severity = b.count > 10 ? 'critical' : b.count > 3 ? 'high' : 'medium';
  const locations: SourceLocation[] = [];
  if (b.componentHint) {
    locations.push({ file: '', symbol: b.componentHint });
  }
  const m = /at\s+\S+\s+\((.+?):(\d+):(\d+)\)/.exec(b.topFrame);
  if (m) {
    locations.push({ file: m[1] ?? '', line: Number(m[2]), column: Number(m[3]) });
  }
  return {
    id: `${b.isRejection ? 'rej' : 'err'}:${hash(b.message + b.topFrame)}`,
    detectorId: 'runtime-error',
    category: b.isRejection ? 'unhandled-rejection' : 'runtime-error',
    severity,
    title: b.isRejection ? `Unhandled rejection: ${truncate(b.message, 80)}` : truncate(b.message, 100),
    summary: `${b.count} occurrence(s)${b.componentHint ? ` near ${b.componentHint}` : ''}.`,
    detail: b.stack,
    confidence: 0.95,
    occurrences: b.count,
    firstSeenMs: b.firstSeen,
    lastSeenMs: b.lastSeen,
    locations,
    evidenceEventSeq: b.seq.slice(-10),
    tags: [b.isRejection ? 'rejection' : 'error'],
  };
}

function dedupe(arr: AnalysisResult[]): AnalysisResult[] {
  const out = new Map<string, AnalysisResult>();
  for (const r of arr) out.set(r.id, r);
  return Array.from(out.values());
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}
