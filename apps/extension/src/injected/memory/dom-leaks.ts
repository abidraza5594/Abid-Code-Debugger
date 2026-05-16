/**
 * Detects detached DOM subtrees. Strategy:
 *   1. MutationObserver watches every `removedNodes` event.
 *   2. We register each removed Element in a FinalizationRegistry-backed bookkeeping map.
 *   3. After a small delay we check whether the element is still in `document.contains`. If the
 *      element is *not* in the document but is still reachable (i.e. our WeakRef.deref returns
 *      a value), some other strong reference is holding it — that is the leak signal.
 *
 * We emit aggregated counts plus three example detached shapes.
 */

import { bridge } from '../bridge.js';

interface Candidate {
  ref: WeakRef<Element>;
  tag: string;
  attrs: Record<string, string>;
  depth: number;
  removedAt: number;
}

const POLL_MS = 5000;
const MIN_CANDIDATES_TO_REPORT = 5;
const MAX_TRACKED = 5000;

let installed = false;
let candidates: Candidate[] = [];

export function installDomLeakDetector(): void {
  if (installed) return;
  installed = true;

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      r.removedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (candidates.length >= MAX_TRACKED) return;
        candidates.push({
          ref: new WeakRef(node),
          tag: node.tagName.toLowerCase(),
          attrs: capAttrs(node),
          depth: depthOf(node),
          removedAt: performance.now(),
        });
      });
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  setInterval(scan, POLL_MS);
}

function capAttrs(node: Element): Record<string, string> {
  const out: Record<string, string> = {};
  const attrs = node.attributes;
  for (let i = 0; i < Math.min(attrs.length, 5); i++) {
    const a = attrs.item(i);
    if (!a) continue;
    out[a.name] = a.value.length > 80 ? `${a.value.slice(0, 80)}…` : a.value;
  }
  return out;
}

function depthOf(node: Element): number {
  let d = 0;
  let cur: Element | null = node;
  while (cur && cur.parentElement) {
    cur = cur.parentElement;
    d++;
  }
  return d;
}

function scan(): void {
  if (candidates.length === 0) return;
  const stillRetained: Candidate[] = [];
  const examples: Array<{ tag: string; attrs: Record<string, string>; depth: number }> = [];
  for (const c of candidates) {
    const node = c.ref.deref();
    if (!node) continue; // GC'd — not a leak
    if (document.contains(node)) continue; // re-inserted
    stillRetained.push(c);
    if (examples.length < 3) {
      examples.push({ tag: c.tag, attrs: c.attrs, depth: c.depth });
    }
  }
  candidates = stillRetained.slice(-MAX_TRACKED);
  if (stillRetained.length >= MIN_CANDIDATES_TO_REPORT) {
    bridge.emit({
      source: 'dom-leak',
      detachedCount: stillRetained.length,
      examples,
    });
  }
}
