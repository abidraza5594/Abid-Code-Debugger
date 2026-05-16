/**
 * Cumulative Layout Shift (CLS) observer. Reports any layout-shift entry above a threshold and
 * attributes it to the moved node when possible.
 */

import { bridge } from '../bridge.js';

interface LayoutShiftEntry extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
  sources?: Array<{ node?: Node | null; previousRect: DOMRectInit; currentRect: DOMRectInit }>;
}

const REPORT_THRESHOLD = 0.05;

let observer: PerformanceObserver | undefined;

export function installLayoutShiftObserver(): void {
  if (observer) return;
  try {
    observer = new PerformanceObserver((list) => {
      for (const raw of list.getEntries()) {
        const entry = raw as LayoutShiftEntry;
        if (entry.value < REPORT_THRESHOLD || entry.hadRecentInput) continue;
        const sources = entry.sources?.map((s) => ({
          node: nodeLabel(s.node),
          previousRect: rectInit(s.previousRect),
          currentRect: rectInit(s.currentRect),
        }));
        bridge.emit({
          source: 'layout-shift',
          value: entry.value,
          hadRecentInput: entry.hadRecentInput,
          ...(sources ? { sources } : {}),
        });
      }
    });
    observer.observe({ type: 'layout-shift', buffered: true });
  } catch {
    observer = undefined;
  }
}

function nodeLabel(node: Node | null | undefined): string {
  if (!node) return '(unknown)';
  if (node instanceof Element) {
    return `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${node.className && typeof node.className === 'string' ? `.${node.className.split(/\s+/).slice(0, 2).join('.')}` : ''}`;
  }
  return node.nodeName.toLowerCase();
}

function rectInit(rect: DOMRectInit): DOMRectInit {
  return {
    x: rect.x ?? 0,
    y: rect.y ?? 0,
    width: rect.width ?? 0,
    height: rect.height ?? 0,
  };
}
