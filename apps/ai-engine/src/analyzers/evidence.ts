/**
 * Builds the compact "evidence" text we send to Mistral alongside a detector result. The goal is
 * to give the model just enough signal to reason without flooding the prompt — we cap at a
 * couple of kilobytes per analysis.
 */

import type { AnalysisResult, CapturedEvent } from '@angular-ai-debugger/shared-types';

const MAX_LINES_PER_SOURCE = 20;
const MAX_TOTAL_LINES = 80;

export function buildEvidenceText(result: AnalysisResult, events: CapturedEvent[]): string {
  const referenced = new Set(result.evidenceEventSeq);
  const selected = events.filter((e) => referenced.has(e.seq));
  if (selected.length === 0) return '(no related events captured in the session window)';

  const grouped = new Map<string, CapturedEvent[]>();
  for (const ev of selected) {
    const arr = grouped.get(ev.source) ?? [];
    arr.push(ev);
    grouped.set(ev.source, arr);
  }

  const sections: string[] = [];
  let totalLines = 0;
  for (const [source, group] of grouped) {
    const lines = group
      .slice(0, MAX_LINES_PER_SOURCE)
      .map((ev) => oneLine(ev));
    totalLines += lines.length;
    sections.push(`[${source}]\n${lines.join('\n')}`);
    if (totalLines > MAX_TOTAL_LINES) break;
  }
  return sections.join('\n\n');
}

function oneLine(ev: CapturedEvent): string {
  const t = `${(ev.pageTime / 1000).toFixed(2)}s`;
  switch (ev.source) {
    case 'fetch':
    case 'xhr':
      return `${t} ${ev.kind} ${ev.method} ${ev.url} status=${ev.status ?? '-'} dur=${Math.round(ev.durationMs ?? 0)}ms`;
    case 'console':
      return `${t} ${ev.level} ${truncate(ev.args.join(' '), 200)}`;
    case 'error':
      return `${t} error ${truncate(ev.message, 200)}${ev.componentHint ? ` near ${ev.componentHint}` : ''}`;
    case 'rejection':
      return `${t} rejection ${truncate(ev.reason, 200)}`;
    case 'angular':
      return `${t} angular ${ev.kind} v=${ev.version ?? '?'} ivy=${ev.isIvy ?? '?'}`;
    case 'change-detection':
      return `${t} cd ${ev.kind}${ev.componentName ? ` ${ev.componentName}` : ''} dur=${Math.round(ev.durationMs)}ms${ev.cumulativeCount ? ` cum=${ev.cumulativeCount}` : ''}`;
    case 'zone':
      return `${t} zone task ${ev.taskSource ?? ''} dur=${Math.round(ev.durationMs)}ms`;
    case 'rxjs':
      return `${t} rxjs ${ev.kind} #${ev.subscriptionId}${ev.liveMs ? ` live=${Math.round(ev.liveMs)}ms` : ''}${ev.componentHint ? ` cmp=${ev.componentHint}` : ''}`;
    case 'dom-leak':
      return `${t} detached-dom count=${ev.detachedCount} examples=${ev.examples.map((x) => x.tag).join(',')}`;
    case 'listener-leak':
      return `${t} listener-leak ${ev.target}.${ev.type} count=${ev.count}`;
    case 'memory':
      return `${t} heap used=${Math.round(ev.usedJsHeapSize / 1024 / 1024)}MiB`;
    case 'heap-diff':
      return `${t} heap-diff delta=${Math.round(ev.retainedDeltaBytes / 1024 / 1024)}MiB`;
    case 'long-task':
      return `${t} long-task ${Math.round(ev.durationMs)}ms`;
    case 'fps':
      return `${t} fps ${ev.fps} jank=${ev.jankFrames}`;
    case 'layout-shift':
      return `${t} cls ${ev.value.toFixed(3)}`;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
