import type {
  AiAnalysis,
  AiFixSuggestion,
  AnalysisResult,
  AnyMessage,
  CapturedEvent,
  ControlCommand,
  Envelope,
} from '@angular-ai-debugger/shared-types';
import { uid } from '../shared/runtime.js';

type Tab = 'errors' | 'network' | 'angular' | 'memory' | 'rxjs' | 'performance' | 'ai' | 'fixes';

const port = chrome.runtime.connect({ name: 'devtools-panel' });
const tabId = chrome.devtools.inspectedWindow.tabId;

const state = {
  capturing: true,
  tab: 'errors' as Tab,
  events: [] as CapturedEvent[],
  analyses: [] as AnalysisResult[],
  aiAnalyses: [] as AiAnalysis[],
  fixes: [] as AiFixSuggestion[],
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
    upsertResults(msg.payload.results);
    if (msg.payload.analyses) upsertAiAnalyses(msg.payload.analyses);
    render();
    return;
  }

  if (msg.channel === 'analysis' && msg.type === 'session-update') {
    upsertResults(msg.payload.session.results);
    if (msg.payload.analyses) upsertAiAnalyses(msg.payload.analyses);
    render();
    return;
  }

  if (msg.channel === 'fix' && msg.type === 'suggestion') {
    state.fixes = [
      msg.payload.suggestion,
      ...state.fixes.filter((fix) => fix.id !== msg.payload.suggestion.id),
    ];
    state.tab = 'fixes';
    activateCurrentTab();
    render();
  }
});

const main = document.getElementById('panel-main') as HTMLElement;
const statusLine = document.getElementById('status-line') as HTMLElement;

document.querySelectorAll<HTMLButtonElement>('nav button').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.tab = (btn.dataset.tab ?? 'errors') as Tab;
    activateCurrentTab();
    render();
  });
});

(document.getElementById('btn-toggle') as HTMLButtonElement).addEventListener('click', () => {
  state.capturing = !state.capturing;
  sendControl({ name: state.capturing ? 'start-capture' : 'stop-capture' });
  (document.getElementById('btn-toggle') as HTMLButtonElement).textContent = state.capturing
    ? 'Pause'
    : 'Resume';
  statusLine.textContent = state.capturing ? 'Live capture running' : 'Capture paused';
});

(document.getElementById('btn-clear') as HTMLButtonElement).addEventListener('click', () => {
  state.events = [];
  state.analyses = [];
  state.aiAnalyses = [];
  state.fixes = [];
  sendControl({ name: 'clear-buffer' });
  render();
});

(document.getElementById('btn-analyze') as HTMLButtonElement).addEventListener('click', () => {
  statusLine.textContent = 'Sending captured evidence to the local engine';
  sendControl({ name: 'request-analysis' });
});

(document.getElementById('btn-heap') as HTMLButtonElement).addEventListener('click', () => {
  statusLine.textContent = 'Requesting heap snapshot through Chrome Debugger';
  sendControl({ name: 'request-heap-snapshot' });
});

main.addEventListener('click', (ev) => {
  const target = ev.target;
  if (!(target instanceof HTMLElement)) return;
  const analysisId = target.dataset.fixAnalysisId;
  if (!analysisId) return;
  statusLine.textContent = 'Generating safe fix suggestion';
  sendControl({ name: 'request-fix', analysisId });
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

function activateCurrentTab(): void {
  document.querySelectorAll<HTMLButtonElement>('nav button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === state.tab);
  });
}

function filterFor(tab: Tab): CapturedEvent[] {
  const map: Record<Tab, (e: CapturedEvent) => boolean> = {
    errors: (e) => e.source === 'console' || e.source === 'error' || e.source === 'rejection',
    network: (e) => e.source === 'fetch' || e.source === 'xhr',
    angular: (e) =>
      e.source === 'angular' || e.source === 'change-detection' || e.source === 'zone',
    memory: (e) =>
      e.source === 'memory' ||
      e.source === 'dom-leak' ||
      e.source === 'listener-leak' ||
      e.source === 'heap-diff',
    rxjs: (e) => e.source === 'rxjs',
    performance: (e) =>
      e.source === 'long-task' || e.source === 'fps' || e.source === 'layout-shift',
    ai: () => false,
    fixes: () => false,
  };
  return state.events.filter(map[tab]);
}

function renderTab(tab: Tab, events: CapturedEvent[]): string {
  if (tab === 'ai') return renderAnalyses();
  if (tab === 'fixes') return renderFixes(state.fixes);
  return events
    .slice(-200)
    .reverse()
    .map((event) => renderRow(event))
    .join('');
}

function renderRow(event: CapturedEvent): string {
  const time = formatTime(event.pageTime);
  const sev = severityFor(event);
  switch (event.source) {
    case 'fetch':
    case 'xhr':
      return row(
        time,
        sev,
        `<strong>${escapeHtml(event.method)}</strong> ${escapeHtml(event.url)}`,
        event.status
          ? `${event.status} / ${Math.round(event.durationMs ?? 0)}ms`
          : (event.statusText ?? ''),
      );
    case 'console':
      return row(time, event.level, escapeHtml(event.args.join(' ')), '');
    case 'error':
      return row(time, 'critical', escapeHtml(event.message), event.componentHint ?? '');
    case 'rejection':
      return row(time, 'high', escapeHtml(event.reason), event.origin ?? '');
    case 'angular':
      return row(
        time,
        'info',
        `Angular ${event.kind}`,
        event.version ?? (event.tree ? `${event.tree.length} root(s)` : ''),
      );
    case 'change-detection':
      return row(
        time,
        'info',
        event.componentName ? `CD ${escapeHtml(event.componentName)}` : 'CD tick',
        `${event.cumulativeCount ?? ''} / ${Math.round(event.durationMs)}ms`,
      );
    case 'zone':
      return row(time, 'low', `Zone task ${escapeHtml(event.taskSource ?? '')}`, `${Math.round(event.durationMs)}ms`);
    case 'rxjs':
      return row(
        time,
        'medium',
        `RxJS ${event.kind} #${event.subscriptionId}`,
        event.liveMs ? `${Math.round(event.liveMs)}ms` : '',
      );
    case 'dom-leak':
      return row(
        time,
        'high',
        `Detached DOM: ${event.detachedCount} nodes`,
        event.examples.map((item: { tag: string }) => item.tag).join(', '),
      );
    case 'listener-leak':
      return row(
        time,
        'medium',
        `Listener leak on ${escapeHtml(event.target)}.${escapeHtml(event.type)}`,
        `count=${event.count}, peak=${event.growth}`,
      );
    case 'memory':
      return row(time, 'info', 'Heap sample', `${(event.usedJsHeapSize / 1024 / 1024).toFixed(1)} MiB`);
    case 'heap-diff':
      return row(
        time,
        'high',
        `Heap diff +${(event.retainedDeltaBytes / 1024 / 1024).toFixed(1)} MiB`,
        event.topSuspects.map((suspect: { className: string }) => suspect.className).slice(0, 3).join(', '),
      );
    case 'long-task':
      return row(time, 'medium', 'Long task', `${Math.round(event.durationMs)}ms`);
    case 'fps':
      return row(time, event.fps < 30 ? 'high' : 'info', `FPS ${event.fps}`, `jank=${event.jankFrames}`);
    case 'layout-shift':
      return row(time, 'medium', `Layout shift ${event.value.toFixed(3)}`, '');
  }
  return row(time, 'info', 'Unknown event', '');
}

function renderAnalyses(): string {
  if (state.analyses.length === 0) {
    return '<div class="empty">Click <em>Analyze</em> to ask the local engine for a root-cause review.</div>';
  }

  const aiByResult = new Map(state.aiAnalyses.map((analysis) => [analysis.resultId, analysis]));
  return state.analyses
    .map((result) => {
      const ai = aiByResult.get(result.id);
      const actions =
        ai?.recommendedActions.map((action: string) => `<li>${escapeHtml(action)}</li>`).join('') ??
        '';
      return `
    <div class="ai-card">
      <h3><span class="badge ${result.severity}">${result.severity}</span> ${escapeHtml(result.title)}</h3>
      <p>${escapeHtml(result.summary)}</p>
      ${result.detail ? `<pre>${escapeHtml(result.detail)}</pre>` : ''}
      ${
        ai
          ? `<p><strong>${escapeHtml(ai.headline)}</strong></p>
             <p>${escapeHtml(ai.rootCause)}</p>
             <p>${escapeHtml(ai.explanation)}</p>
             <ol>${actions}</ol>
             <button type="button" data-fix-analysis-id="${escapeHtml(ai.id)}">Generate safe fix</button>`
          : '<p class="meta">Detector result is live. Click Analyze for AI root-cause synthesis.</p>'
      }
      <div class="meta">confidence ${Math.round(result.confidence * 100)}% / occurrences ${result.occurrences} / detector ${escapeHtml(result.detectorId)}</div>
    </div>`;
    })
    .join('');
}

function renderFixes(fixes: AiFixSuggestion[]): string {
  if (fixes.length === 0) {
    return '<div class="empty">Generate a fix from an AI suggestion to preview it here.</div>';
  }
  return fixes
    .map(
      (fix) => `
    <div class="fix-card">
      <h3><span class="badge ${fix.autoApplicable ? 'low' : 'medium'}">${fix.autoApplicable ? 'safe' : 'review'}</span> ${escapeHtml(fix.title)}</h3>
      <p>${escapeHtml(fix.autoApplicableReason)}</p>
      <pre>${escapeHtml(fix.diff || fix.body)}</pre>
      <div class="meta">model ${escapeHtml(fix.model)}${fix.files?.length ? ` / ${fix.files.map(escapeHtml).join(', ')}` : ''}</div>
    </div>`,
    )
    .join('');
}

function row(time: string, sev: string, title: string, meta: string): string {
  return `<div class="row"><span class="meta">${time}</span><div>${title}</div><span class="badge ${sev}">${escapeHtml(meta || sev)}</span></div>`;
}

function severityFor(event: CapturedEvent): string {
  switch (event.source) {
    case 'error':
    case 'rejection':
      return 'critical';
    case 'console':
      return event.level === 'error' ? 'high' : event.level === 'warn' ? 'medium' : 'info';
    default:
      return 'info';
  }
}

function upsertResults(results: AnalysisResult[]): void {
  for (const result of results) {
    state.analyses = [result, ...state.analyses.filter((item) => item.id !== result.id)];
  }
}

function upsertAiAnalyses(analyses: AiAnalysis[]): void {
  for (const analysis of analyses) {
    state.aiAnalyses = [analysis, ...state.aiAnalyses.filter((item) => item.id !== analysis.id)];
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(ms: number): string {
  return `${(Math.floor(ms) / 1000).toFixed(2)}s`;
}

render();
