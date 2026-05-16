/**
 * Duplicate request detector. Flags the same (method, url-pattern) firing more than N times
 * inside a small window — usually the smell is a missed `shareReplay`, a poll loop, or
 * change-detection re-evaluating a template binding that triggers HttpClient.
 */

import type {
  AnalysisResult,
  Detector,
} from '@angular-ai-debugger/shared-types';
import { eventsOf } from '@angular-ai-debugger/shared-types';

const WINDOW_MS = 5000;
const COUNT_THRESHOLD = 4;

interface Slot {
  key: string;
  times: number[];
  totalCount: number;
  examples: string[];
  firstSeen: number;
  lastSeen: number;
  seq: number[];
}

export const duplicateRequestDetector: Detector = {
  id: 'duplicate-request',
  name: 'Duplicate / polling requests',
  consumes: ['fetch', 'xhr'],
  setup() {
    /* nothing */
  },
  analyze(events, ctx) {
    const slots = (ctx.state.get('slots') as Map<string, Slot> | undefined) ?? new Map();
    ctx.state.set('slots', slots);
    const results: AnalysisResult[] = [];

    for (const e of [...eventsOf(events, 'fetch'), ...eventsOf(events, 'xhr')]) {
      if (e.kind !== 'request') continue;
      const key = `${e.method} ${patternize(e.url)}`;
      const slot = slots.get(key) ?? {
        key,
        times: [],
        totalCount: 0,
        examples: [],
        firstSeen: e.pageTime,
        lastSeen: e.pageTime,
        seq: [],
      };
      slot.times.push(e.pageTime);
      slot.totalCount += 1;
      slot.lastSeen = e.pageTime;
      slot.seq.push(e.seq);
      while (slot.times.length > 0 && slot.times[0]! < e.pageTime - WINDOW_MS) slot.times.shift();
      if (slot.examples.length < 3) slot.examples.push(e.url);
      slots.set(key, slot);

      if (slot.times.length >= COUNT_THRESHOLD) {
        results.push(toResult(slot));
      }
    }
    return dedupe(results);
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

function toResult(slot: Slot): AnalysisResult {
  const rate = slot.times.length / (WINDOW_MS / 1000);
  return {
    id: `dup:${slot.key}`,
    detectorId: 'duplicate-request',
    category: 'duplicate-request',
    severity: rate > 4 ? 'high' : 'medium',
    title: `Duplicated request ${slot.key}`,
    summary: `${slot.times.length} calls in a ${WINDOW_MS / 1000}s window (${rate.toFixed(1)}/s).`,
    detail: slot.examples.join('\n'),
    confidence: 0.85,
    occurrences: slot.totalCount,
    firstSeenMs: slot.firstSeen,
    lastSeenMs: slot.lastSeen,
    locations: [],
    evidenceEventSeq: slot.seq.slice(-10),
    tags: ['network', 'duplicate'],
  };
}

function dedupe(arr: AnalysisResult[]): AnalysisResult[] {
  const out = new Map<string, AnalysisResult>();
  for (const r of arr) out.set(r.id, r);
  return Array.from(out.values());
}
