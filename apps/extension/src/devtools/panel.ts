/**
 * DevTools panel — runs in its own document. Talks to the background service worker via a long-
 * lived Port. Maintains an in-memory store of captured events and renders simple tabs.
 *
 * We avoid a UI framework dependency here to keep the extension bundle small and the load fast.
 * The richer Angular dashboard at apps/dashboard mirrors this view for standalone use.
 */

import type {
  AnalysisResult,
  AnyMessage,
  CapturedEvent,
  Envelope,
  ControlCommand,
} from '@angular-ai-debugger/shared-types';
import { uid } from '../shared/runtime.js';

type Tab = 'errors' | 'network' | 'angular' | 'memory' | 'rxjs' | 'performance' | 'ai';

const port = chrome.runtime.connect({ name: 'devtools-panel' });
const tabId = chrome.devtools.inspectedWindow.tabId;

const state = {
  capturing: true,
  tab: 'errors' as Tab,
  events: [] as CapturedEvent[],
  analyses: [] as AnalysisResult[],
};

port.postMessage({
  id: uid('reg'),
  channel: 'session',
  type: 'register',
  source: 'devtools',
  payload: { tabId },
} satisfies Envelope);

port.onMessage.addListener((msg: AnyMessage) => {
  if (msg.channel === 'capture') {
    const events = msg.type === 'batch' ? msg.payload.events : [msg.payload.event];
    state.events.push(...events);
    if (state.events.length > 20_000) state.events = state.events.slice(-15_000);
    render();
    return;
  }
  if (msg.channel === 'analysis' && msg.type === 'results') {
    state.analyses.push(...msg.payload.results);
    render();
  }
});

/* ------------------------------------------------------------------ UI bits */

const main = document.getElementById('panel-main') as HTMLElement;
document.querySelectorAll<HTMLButtonElement>('nav button').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.tab = (btn.dataset.tab ?? 'errors') as Tab;
    document.querySelectorAll('nav button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    render();
  });
});

(document.getElementById('btn-toggle') as HTMLButtonElement).addEventListener('click', () => {
  state.capturing = !state.capturing;
  sendControl({ name: state.capturing ? 'start-capture' : 'stop-capture' });
  (document.getElementById('btn-toggle') as HTMLButtonElement).textContent = state.capturing
    ? 'Pause'
    : 'Resume';
});

(document.getElementById('btn-clear') as HTMLButtonElement).addEventListener('click', () => {
  state.events = [];
  state.analyses = [];
  sendControl({ name: 'clear-buffer' });
  render();
});

(document.getElementById('btn-analyze') as HTMLButtonElement).addEventListener('click', () => {
  sendControl({ name: 'request-analysis' });
});

function sendControl(cmd: ControlCommand): void {
  port.postMessage({
    id: uid('ctl'),
    channel: 'control',
    type: 'command',
    source: 'devtools',
    payload: cmd,
  } satisfies Envelope);
}

function render(): void {
  const filtered = filterFor(state.tab);
  const html = renderTab(state.tab, filtered);
  main.innerHTML = html || '<div class="empty">No matching events yet.</div>';
}

function filterFor(tab: Tab): CapturedEvent[] {
  const map: Record<Tab, (e: CapturedEvent) => boolean> = {
    errors: (e) => e.source === 'console' || e.source === 'error' || e.source === 'rejection',
    network: (e) => e.source === 'fetch' || e.source === 'xhr',
    angular: (e) =>
      e.source === 'angular' ||
      e.source === 'change-detection' ||
      e.source === 'zone',
    memory: (e) =>
      e.source === 'memory' ||
      e.source === 'dom-leak' ||
      e.source === 'listener-leak' ||
      e.source === 'heap-diff',
    rxjs: (e) => e.source === 'rxjs',
    performance: (e) =>
      e.source === 'long-task' || e.source === 'fps' || e.source === 'layout-shift',
    ai: () => false, // ai tab renders state.analyses
  };
  return state.events.filter(map[tab]);
}

function renderTab(tab: Tab, events: CapturedEvent[]): string {
  if (tab === 'ai') return renderAnalyses(state.analyses);
  return events
    .slice(-200)
    .reverse()
    .map((e) => renderRow(e))
    .join('');
}

function renderRow(e: CapturedEvent): string {
  const time = formatTime(e.pageTime);
  const sev = severityFor(e);
  switch (e.source) {
    case 'fetch':
    case 'xhr':
      return row(
        time,
        sev,
        `<strong>${escapeHtml(e.method)}</strong> ${escapeHtml(e.url)}`,
        e.status ? `${e.status} · ${Math.round(e.durationMs ?? 0)}ms` : (e.statusText ?? ''),
      );
    case 'console':
      return row(time, e.level, escapeHtml(e.args.join(' ')), '');
    case 'error':
      return row(time, 'critical', escapeHtml(e.message), e.componentHint ?? '');
    case 'rejection':
      return row(time, 'high', escapeHtml(e.reason), e.origin ?? '');
    case 'angular':
      return row(time, 'info', `Angular ${e.kind}`, e.version ?? '');
    case 'change-detection':
      return row(
        time,
        'info',
        e.componentName ? `CD ${e.componentName}` : 'CD tick',
        `${e.cumulativeCount ?? ''} · ${Math.round(e.durationMs)}ms`,
      );
    case 'zone':
      return row(time, 'low', `Zone task ${e.taskSource ?? ''}`, `${Math.round(e.durationMs)}ms`);
    case 'rxjs':
      return row(time, 'medium', `RxJS ${e.kind} #${e.subscriptionId}`, e.liveMs ? `${Math.round(e.liveMs)}ms` : '');
    case 'dom-leak':
      return row(time, 'high', `Detached DOM: ${e.detachedCount} nodes`, e.examples.map((x) => x.tag).join(', '));
    case 'listener-leak':
      return row(
        time,
        'medium',
        `Listener leak on ${e.target}.${e.type}`,
        `count=${e.count}, peak=${e.growth}`,
      );
    case 'memory':
      return row(time, 'info', 'Heap sample', `${(e.usedJsHeapSize / 1024 / 1024).toFixed(1)} MiB`);
    case 'heap-diff':
      return row(
        time,
        'high',
        `Heap diff +${(e.retainedDeltaBytes / 1024 / 1024).toFixed(1)} MiB`,
        e.topSuspects.map((s) => s.className).slice(0, 3).join(', '),
      );
    case 'long-task':
      return row(time, 'medium', 'Long task', `${Math.round(e.durationMs)}ms`);
    case 'fps':
      return row(time, e.fps < 30 ? 'high' : 'info', `FPS ${e.fps}`, `jank=${e.jankFrames}`);
    case 'layout-shift':
      return row(time, 'medium', `Layout shift ${e.value.toFixed(3)}`, '');
  }
}

function renderAnalyses(results: AnalysisResult[]): string {
  if (results.length === 0) {
    return '<div class="empty">Click <em>Analyze</em> to ask Mistral for a root-cause review.</div>';
  }
  return results
    .map(
      (r) => `
    <div class="ai-card">
      <h3><span class="badge ${r.severity}">${r.severity}</span> ${escapeHtml(r.title)}</h3>
      <div>${escapeHtml(r.summary)}</div>
      ${r.detail ? `<pre>${escapeHtml(r.detail)}</pre>` : ''}
      <div style="color: #7d8590; font-size: 11px;">confidence ${Math.round(r.confidence * 100)}% · occurrences ${r.occurrences} · detector ${escapeHtml(r.detectorId)}</div>
    </div>`,
    )
    .join('');
}

function row(time: string, sev: string, title: string, meta: string): string {
  return `<div class="row"><span style="color:#7d8590;font-variant-numeric:tabular-nums;font-size:11px;">${time}</span><div>${title}</div><span class="badge ${sev}">${meta || sev}</span></div>`;
}

function severityFor(e: CapturedEvent): string {
  switch (e.source) {
    case 'error':
    case 'rejection':
      return 'critical';
    case 'console':
      return e.level === 'error' ? 'high' : e.level === 'warn' ? 'medium' : 'info';
    default:
      return 'info';
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(ms: number): string {
  const total = Math.floor(ms);
  const s = (total / 1000).toFixed(2);
  return `${s}s`;
}

render();
