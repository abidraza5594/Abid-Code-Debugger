/**
 * Periodically samples performance.memory (Chrome-only) and emits a memory event so the
 * dashboard can plot heap growth.
 */

import { bridge } from '../bridge.js';

interface ChromePerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

const SAMPLE_INTERVAL_MS = 3000;

let installed = false;

export function installMemorySampler(): void {
  if (installed) return;
  const perf = performance as unknown as { memory?: ChromePerformanceMemory };
  if (!perf.memory) return;
  installed = true;
  setInterval(() => {
    const m = perf.memory;
    if (!m) return;
    bridge.emit({
      source: 'memory',
      usedJsHeapSize: m.usedJSHeapSize,
      totalJsHeapSize: m.totalJSHeapSize,
      jsHeapSizeLimit: m.jsHeapSizeLimit,
    });
  }, SAMPLE_INTERVAL_MS);
}
