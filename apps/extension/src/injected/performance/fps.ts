/**
 * FPS sampler. Counts requestAnimationFrame cadence over a sliding 1-second window and emits
 * the sampled FPS plus the number of "jank frames" (frames >16.67ms apart).
 */

import { bridge } from '../bridge.js';

const WINDOW_MS = 1000;
const JANK_THRESHOLD_MS = 50; // a single frame >50ms is visibly janky

let installed = false;

export function installFpsSampler(): void {
  if (installed) return;
  installed = true;
  let lastTs = performance.now();
  let frames = 0;
  let jank = 0;
  let windowStart = lastTs;

  const tick = (ts: DOMHighResTimeStamp): void => {
    frames++;
    const delta = ts - lastTs;
    if (delta > JANK_THRESHOLD_MS) jank++;
    lastTs = ts;
    if (ts - windowStart >= WINDOW_MS) {
      const elapsed = ts - windowStart;
      const fps = Math.round((frames * 1000) / elapsed);
      bridge.emit({
        source: 'fps',
        fps,
        jankFrames: jank,
        windowMs: elapsed,
      });
      frames = 0;
      jank = 0;
      windowStart = ts;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
