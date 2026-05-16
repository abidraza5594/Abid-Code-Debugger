/**
 * DOM-leak detector. Inputs the dom-leak events from the page (detached count + examples) and
 * a small heuristic for listener-leak. Heap diff events feed in too when the user requested a
 * snapshot.
 */

import type { AnalysisResult, Detector } from '@angular-ai-debugger/shared-types';
import { eventsOf } from '@angular-ai-debugger/shared-types';

export const domLeakDetector: Detector = {
  id: 'dom-leak',
  name: 'Detached DOM & listener leaks',
  consumes: ['dom-leak', 'listener-leak', 'heap-diff'],
  setup() {
    /* nothing */
  },
  analyze(events) {
    const results: AnalysisResult[] = [];

    for (const e of eventsOf(events, 'dom-leak')) {
      results.push({
        id: 'dom-leak:detached',
        detectorId: 'dom-leak',
        category: 'detached-dom',
        severity: e.detachedCount > 200 ? 'high' : e.detachedCount > 50 ? 'medium' : 'low',
        title: `Detached DOM: ${e.detachedCount} nodes still reachable`,
        summary:
          'Nodes are removed from the document but still strongly referenced. Common culprits: Angular destroying a view while a JS handler holds the element.',
        detail: e.examples.map((x) => `<${x.tag} ${formatAttrs(x.attrs)}>`).join('\n'),
        confidence: 0.8,
        occurrences: e.detachedCount,
        firstSeenMs: e.pageTime,
        lastSeenMs: e.pageTime,
        locations: [],
        evidenceEventSeq: [e.seq],
        tags: ['memory', 'dom'],
      });
    }

    for (const e of eventsOf(events, 'listener-leak')) {
      results.push({
        id: `listener-leak:${e.target}:${e.type}`,
        detectorId: 'dom-leak',
        category: 'listener-leak',
        severity: e.count > 200 ? 'high' : 'medium',
        title: `Event listener leak ${e.target}.${e.type}`,
        summary: `Count ${e.count} (peak ${e.growth}). Listener never released.`,
        confidence: 0.75,
        occurrences: e.count,
        firstSeenMs: e.pageTime,
        lastSeenMs: e.pageTime,
        locations: [],
        evidenceEventSeq: [e.seq],
        tags: ['memory', 'listener'],
      });
    }

    for (const e of eventsOf(events, 'heap-diff')) {
      results.push({
        id: `heap-diff:${e.seq}`,
        detectorId: 'dom-leak',
        category: 'heap-growth',
        severity: e.retainedDeltaBytes > 25 * 1024 * 1024 ? 'high' : 'medium',
        title: `Heap grew by ${(e.retainedDeltaBytes / 1024 / 1024).toFixed(1)} MiB`,
        summary:
          'Comparison of two heap snapshots showed significant retained growth between checkpoints.',
        detail: `Top retainers:\n${e.topSuspects
          .map((s) => `${s.className} — ${s.instances} instances, ${(s.bytes / 1024 / 1024).toFixed(1)} MiB`)
          .join('\n')}`,
        confidence: 0.85,
        occurrences: 1,
        firstSeenMs: e.pageTime,
        lastSeenMs: e.pageTime,
        locations: [],
        evidenceEventSeq: [e.seq],
        tags: ['memory', 'heap'],
      });
    }

    return results;
  },
  finalize: () => [],
  cleanup() {
    /* nothing */
  },
};

function formatAttrs(attrs: Record<string, string>): string {
  return Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
}
