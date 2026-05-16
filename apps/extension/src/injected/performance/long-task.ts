/**
 * Observe Long Tasks (>50ms blocking the main thread) via PerformanceObserver. Each long task
 * carries optional attribution to the iframe/container that caused it.
 */

import { bridge } from '../bridge.js';

let observer: PerformanceObserver | undefined;

export function installLongTaskObserver(): void {
  if (observer) return;
  if (!('PerformanceObserver' in window)) return;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEntry[]) {
        const attribution = (entry as PerformanceEntry & {
          attribution?: Array<{ name: string; containerType: string }>;
        }).attribution;
        bridge.emit({
          source: 'long-task',
          durationMs: entry.duration,
          startTime: entry.startTime,
          ...(attribution
            ? { attribution: attribution.map((a) => ({ name: a.name, containerType: a.containerType })) }
            : {}),
        });
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {
    observer = undefined;
  }
}
