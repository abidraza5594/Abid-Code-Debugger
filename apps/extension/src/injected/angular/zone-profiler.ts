/**
 * Zone.js profiler. Hooks the `onInvokeTask` and `onInvoke` semantics by patching the global
 * Zone.prototype to record per-task duration. We also wrap ApplicationRef.tick() so we can
 * directly observe change-detection cycles even on apps that have configured a custom zone.
 *
 * Sampling: we keep every long task (>16 ms) but sample shorter tasks at 10% to bound volume.
 */

import { bridge } from '../bridge.js';

interface ZoneCtor {
  prototype: ZonePrototype;
}
interface ZonePrototype {
  runTask?: (task: ZoneTask, applyThis?: unknown, applyArgs?: unknown) => unknown;
  invokeTask?: (task: ZoneTask, applyThis?: unknown, applyArgs?: unknown) => unknown;
  run?: (callback: Function, applyThis?: unknown, applyArgs?: unknown, source?: string) => unknown;
}
interface ZoneTask {
  source: string;
  type: 'macroTask' | 'microTask' | 'eventTask';
  callback?: Function;
}

const SAMPLING_THRESHOLD_MS = 16;
const SAMPLING_RATE = 0.1;

let installed = false;

export function installZoneProfiler(): void {
  if (installed) return;
  const Zone = (window as unknown as { Zone?: ZoneCtor }).Zone;
  if (!Zone || !Zone.prototype.runTask) {
    // Zoneless or Zone not loaded yet — caller should retry once Angular is detected.
    return;
  }
  installed = true;

  const origRunTask = Zone.prototype.runTask;
  Zone.prototype.runTask = function (
    this: unknown,
    task: ZoneTask,
    applyThis?: unknown,
    applyArgs?: unknown,
  ): unknown {
    const start = performance.now();
    try {
      return (origRunTask as Function).call(this, task, applyThis, applyArgs);
    } finally {
      const duration = performance.now() - start;
      if (duration >= SAMPLING_THRESHOLD_MS || Math.random() < SAMPLING_RATE) {
        bridge.emit({
          source: 'zone',
          kind: 'task',
          durationMs: duration,
          taskSource: task.source,
        });
      }
    }
  };
}

/**
 * Patch ApplicationRef.tick(). Must run *after* Angular has bootstrapped so the prototype is
 * populated. Returns true on success.
 */
export function installApplicationRefTickHook(): boolean {
  // Angular hides ApplicationRef on root elements as the `__ngContext__` property. The cleanest
  // path is to walk root elements, grab the injector from `ng.getInjector`, and request the
  // ApplicationRef instance.
  const ng = window.ng;
  const roots = window.getAllAngularRootElements?.() ?? [];
  if (!ng || roots.length === 0) return false;
  const injector = ng.getInjector?.(roots[0]!) as
    | { get?: (token: unknown) => unknown }
    | undefined;
  if (!injector?.get) return false;
  const ApplicationRefToken = (window as unknown as { ng?: { coreTokens?: { ApplicationRef?: unknown } } })
    .ng?.coreTokens?.ApplicationRef;
  // If we don't have the token cached, fall through to the prototype-patching path below.
  const appRef = ApplicationRefToken ? (injector.get(ApplicationRefToken) as { tick?: () => void } | undefined) : undefined;
  if (!appRef?.tick) {
    return patchApplicationRefViaPrototype();
  }
  return wrapTick(appRef);
}

function patchApplicationRefViaPrototype(): boolean {
  // Walk every Angular root element and try to find an ApplicationRef-shaped object on it.
  const roots = window.getAllAngularRootElements?.() ?? [];
  for (const root of roots) {
    const ctx = (root as unknown as { __ngContext__?: unknown[] }).__ngContext__;
    if (!ctx) continue;
    for (const entry of ctx) {
      if (entry && typeof entry === 'object' && 'tick' in (entry as object)) {
        if (wrapTick(entry as { tick: () => void })) return true;
      }
    }
  }
  return false;
}

function wrapTick(appRef: { tick?: () => void; _ngDebug?: boolean }): boolean {
  if (!appRef.tick || appRef._ngDebug) return false;
  const orig = appRef.tick.bind(appRef);
  appRef.tick = (): void => {
    const start = performance.now();
    try {
      orig();
    } finally {
      bridge.emit({
        source: 'change-detection',
        kind: 'tick',
        durationMs: performance.now() - start,
      });
    }
  };
  appRef._ngDebug = true;
  return true;
}
