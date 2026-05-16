/**
 * Detects an Angular application on the page and exposes a normalized AngularRuntime handle
 * for the rest of the injected modules.
 *
 * Angular 16+ ships Ivy by default; we look up via `ng.getComponent` / `ng.applyChanges` which
 * are attached to `window.ng` (the global Ivy debug API). Older Zone-based apps still work via
 * the legacy `ng.probe` and `getAllAngularRootElements`. Zoneless apps (Angular 19+) skip the
 * Zone profiler and instead rely on `afterRender` hooks.
 */

import { bridge } from '../bridge.js';

declare global {
  interface Window {
    ng?: {
      getComponent?: (el: Element) => unknown;
      getDirectives?: (el: Element) => unknown[];
      getHostElement?: (cmp: object) => Element;
      getOwningComponent?: (el: Element) => unknown;
      applyChanges?: (cmp: object) => void;
      getInjector?: (el: Element) => unknown;
      probe?: (el: Element) => unknown;
    };
    getAllAngularRootElements?: () => Element[];
    Zone?: { current?: { name?: string } } & ((...args: unknown[]) => unknown);
    ngDevMode?: unknown;
  }
}

export interface AngularRuntime {
  detected: boolean;
  version?: string;
  isIvy: boolean;
  zoneless: boolean;
  rootElements: Element[];
}

let cached: AngularRuntime | undefined;

export function detectAngular(): AngularRuntime {
  if (cached) return cached;
  const rootElements = window.getAllAngularRootElements?.() ?? [];
  const hasIvyGlobal = typeof window.ng?.getComponent === 'function';
  const hasZone = !!window.Zone;
  const detected = rootElements.length > 0 || hasIvyGlobal;
  const version = readVersionFromRoot(rootElements[0]);
  cached = {
    detected,
    isIvy: hasIvyGlobal || !!window.ngDevMode,
    zoneless: detected && !hasZone,
    rootElements,
    ...(version !== undefined ? { version } : {}),
  };
  if (detected) {
    bridge.emit({
      source: 'angular',
      kind: 'detected',
      isIvy: cached.isIvy,
      zoneless: cached.zoneless,
      ...(version !== undefined ? { version } : {}),
    });
  }
  return cached;
}

function readVersionFromRoot(root: Element | undefined): string | undefined {
  if (!root) return undefined;
  const attr = root.getAttribute('ng-version');
  return attr ?? undefined;
}

/**
 * Some Angular features become detectable only after the bootstrap has completed (e.g. when
 * `ng-version` attribute is set). We poll briefly at startup, then give up.
 */
export function waitForAngular(maxMs = 5000): Promise<AngularRuntime> {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (): void => {
      cached = undefined;
      const runtime = detectAngular();
      if (runtime.detected || performance.now() - start > maxMs) {
        resolve(runtime);
        return;
      }
      setTimeout(tick, 200);
    };
    tick();
  });
}
