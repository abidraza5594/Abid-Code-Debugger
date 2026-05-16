/**
 * Performance detectors that don't fit the other buckets: long task, low FPS, layout shift.
 */

import type { AnalysisResult, Detector } from '@angular-ai-debugger/shared-types';
import { eventsOf } from '@angular-ai-debugger/shared-types';

const LONG_TASK_REPORT_MS = 100;
const LOW_FPS_THRESHOLD = 24;

export const performanceDetector: Detector = {
  id: 'performance',
  name: 'Performance issues',
  consumes: ['long-task', 'fps', 'layout-shift'],
  setup() {
    /* nothing */
  },
  analyze(events, ctx) {
    const stat = (ctx.state.get('stat') as {
      maxLong: number;
      longCount: number;
      lowFpsCount: number;
      worstFps: number;
      cls: number;
      latestSeq: number;
      firstSeen?: number;
      lastSeen?: number;
    } | undefined) ?? {
      maxLong: 0,
      longCount: 0,
      lowFpsCount: 0,
      worstFps: Infinity,
      cls: 0,
      latestSeq: 0,
    };
    ctx.state.set('stat', stat);

    for (const e of eventsOf(events, 'long-task')) {
      if (e.durationMs < LONG_TASK_REPORT_MS) continue;
      stat.longCount += 1;
      stat.maxLong = Math.max(stat.maxLong, e.durationMs);
      stat.latestSeq = e.seq;
      stat.firstSeen ??= e.pageTime;
      stat.lastSeen = e.pageTime;
    }
    for (const e of eventsOf(events, 'fps')) {
      if (e.fps < LOW_FPS_THRESHOLD) stat.lowFpsCount += 1;
      stat.worstFps = Math.min(stat.worstFps, e.fps);
      stat.latestSeq = e.seq;
      stat.firstSeen ??= e.pageTime;
      stat.lastSeen = e.pageTime;
    }
    for (const e of eventsOf(events, 'layout-shift')) {
      stat.cls += e.value;
      stat.latestSeq = e.seq;
      stat.firstSeen ??= e.pageTime;
      stat.lastSeen = e.pageTime;
    }

    const out: AnalysisResult[] = [];
    if (stat.longCount > 0) {
      out.push({
        id: 'perf:long-task',
        detectorId: 'performance',
        category: 'long-task',
        severity: stat.maxLong > 500 ? 'high' : 'medium',
        title: `Long tasks: ${stat.longCount} (max ${Math.round(stat.maxLong)}ms)`,
        summary: 'Main thread blocked for >100ms. Suspect synchronous work in component init, large change-detection, or sync XHR.',
        confidence: 0.95,
        occurrences: stat.longCount,
        firstSeenMs: stat.firstSeen ?? 0,
        lastSeenMs: stat.lastSeen ?? 0,
        locations: [],
        evidenceEventSeq: [stat.latestSeq],
        tags: ['performance', 'long-task'],
      });
    }
    if (stat.worstFps !== Infinity && stat.worstFps < LOW_FPS_THRESHOLD) {
      out.push({
        id: 'perf:low-fps',
        detectorId: 'performance',
        category: 'low-fps',
        severity: stat.worstFps < 12 ? 'high' : 'medium',
        title: `Frame rate dropped to ${stat.worstFps} fps`,
        summary: 'Animations or layout work cannot keep up. Likely caused by expensive component templates, heavy CSS or scroll handlers.',
        confidence: 0.85,
        occurrences: stat.lowFpsCount,
        firstSeenMs: stat.firstSeen ?? 0,
        lastSeenMs: stat.lastSeen ?? 0,
        locations: [],
        evidenceEventSeq: [stat.latestSeq],
        tags: ['performance', 'fps'],
      });
    }
    if (stat.cls > 0.1) {
      out.push({
        id: 'perf:cls',
        detectorId: 'performance',
        category: 'layout-thrash',
        severity: stat.cls > 0.25 ? 'high' : 'medium',
        title: `Cumulative layout shift: ${stat.cls.toFixed(3)}`,
        summary: 'Visible content shifts after first paint. Investigate images/iframes/fonts missing dimensions.',
        confidence: 0.9,
        occurrences: 1,
        firstSeenMs: stat.firstSeen ?? 0,
        lastSeenMs: stat.lastSeen ?? 0,
        locations: [],
        evidenceEventSeq: [stat.latestSeq],
        tags: ['performance', 'layout'],
      });
    }
    return out;
  },
  finalize: () => [],
  cleanup() {
    /* nothing */
  },
};
