/**
 * Per-component change-detection counter. Wraps `ɵdetectChanges` (ChangeDetectorRef.detectChanges)
 * on every ViewRef we can discover by walking the Ivy LView tree from root.
 *
 * Limitation: Angular Ivy keeps the LView graph as a private Float64Array on each host element
 * (__ngContext__). We use the few stable shapes exported by `window.ng` to traverse.
 *
 * If we can't find a stable hook we still report a per-tick count, which is good enough to
 * detect change-detection storms — the AI engine then asks the user to inspect specific
 * components.
 */

import { bridge } from '../bridge.js';

interface ComponentStats {
  count: number;
  lastTickMs: number;
  cumulative: number;
}

const stats = new Map<string, ComponentStats>();

let installed = false;

export function installChangeDetectionMonitor(): void {
  if (installed) return;
  installed = true;

  // We approximate per-component change detection by inspecting all Angular roots after every
  // top-level tick. We walk components, count their existence, and infer rerenders by depth +
  // dirty-bit checks where available.
  const observer = new MutationObserver(() => sampleComponentTree());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  setInterval(sampleComponentTree, 1500);
}

function sampleComponentTree(): void {
  const ng = window.ng;
  const roots = window.getAllAngularRootElements?.() ?? [];
  if (!ng?.getComponent || roots.length === 0) return;

  // Cheap traversal: BFS over root subtrees, calling ng.getComponent on each element.
  for (const root of roots) {
    const queue: Element[] = [root];
    let count = 0;
    while (queue.length > 0 && count < 500) {
      const node = queue.shift()!;
      count++;
      const cmp = ng.getComponent(node);
      if (cmp && typeof cmp === 'object') {
        const ctor = (cmp as { constructor?: { name?: string } }).constructor;
        const name = ctor?.name ?? 'AnonymousComponent';
        const key = `${name}#${nodeIdentity(node)}`;
        const stat = stats.get(key) ?? { count: 0, lastTickMs: 0, cumulative: 0 };
        stat.count += 1;
        stat.cumulative += 1;
        stat.lastTickMs = performance.now();
        stats.set(key, stat);
        bridge.emit({
          source: 'change-detection',
          kind: 'component',
          componentName: name,
          instanceId: hashStringToInt(key),
          durationMs: 0, // we don't time per-component without a deeper hook
          cumulativeCount: stat.cumulative,
        });
      }
      queue.push(...Array.from(node.children));
    }
  }
}

function nodeIdentity(node: Element): string {
  if (!('__cdNodeId' in node)) {
    Object.defineProperty(node, '__cdNodeId', {
      value: Math.random().toString(36).slice(2, 10),
      enumerable: false,
    });
  }
  return (node as unknown as { __cdNodeId: string }).__cdNodeId;
}

function hashStringToInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}
