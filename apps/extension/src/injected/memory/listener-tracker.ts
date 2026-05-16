/**
 * Tracks addEventListener / removeEventListener calls per (target, type) and emits a
 * listener-leak event when the count for a tuple keeps growing for more than 30s without ever
 * coming down.
 */

import { bridge } from '../bridge.js';

interface TargetStats {
  target: string;
  type: string;
  count: number;
  peak: number;
  lastGrowthAt: number;
}

const REPORT_INTERVAL_MS = 30_000;
const GROWTH_THRESHOLD = 20;

const counts = new Map<string, TargetStats>();

let installed = false;

export function installListenerTracker(): void {
  if (installed) return;
  installed = true;
  const targets: Array<{ ctor: Function; label: (target: object) => string }> = [
    { ctor: EventTarget, label: () => '' },
    { ctor: Window, label: () => 'window' },
    { ctor: Document, label: () => 'document' },
  ];

  // We monkey-patch EventTarget.prototype methods once. The label callback identifies the
  // concrete target instance for reporting.
  const origAdd = EventTarget.prototype.addEventListener;
  const origRemove = EventTarget.prototype.removeEventListener;

  EventTarget.prototype.addEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    bumpCounter(targetLabel(this), type, 1);
    return origAdd.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) {
    bumpCounter(targetLabel(this), type, -1);
    return origRemove.call(this, type, listener, options);
  };

  setInterval(() => report(), REPORT_INTERVAL_MS);

  void targets; // keep tree-shake hint for label heuristic future-proofing
}

function bumpCounter(target: string, type: string, delta: number): void {
  const key = `${target}::${type}`;
  const stat = counts.get(key) ?? { target, type, count: 0, peak: 0, lastGrowthAt: performance.now() };
  stat.count += delta;
  if (stat.count > stat.peak) {
    stat.peak = stat.count;
    stat.lastGrowthAt = performance.now();
  }
  counts.set(key, stat);
}

function targetLabel(target: EventTarget): string {
  if (target === window) return 'window';
  if (target === document) return 'document';
  if (target instanceof HTMLElement) {
    return `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ''}`;
  }
  // For SVG, AbortSignal, IntersectionObserver et al we just use the constructor name.
  return target.constructor?.name ?? 'EventTarget';
}

function report(): void {
  const now = performance.now();
  for (const stat of counts.values()) {
    if (stat.peak < GROWTH_THRESHOLD) continue;
    // Only complain when the count is high *and* hasn't dropped recently.
    if (now - stat.lastGrowthAt > REPORT_INTERVAL_MS) continue;
    bridge.emit({
      source: 'listener-leak',
      type: stat.type,
      target: stat.target,
      count: stat.count,
      growth: stat.peak,
    });
  }
}
