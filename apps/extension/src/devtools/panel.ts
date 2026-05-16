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
type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low' | 'info' | 'warn' | 'error';
type SpeedFilter = 'all' | 'failed' | 'slow' | 'medium' | 'fast';

interface DisplayLocation {
  file: string;
  line?: number;
  column?: number;
  symbol?: string;
}

const port = chrome.runtime.connect({ name: 'devtools-panel' });
const tabId = chrome.devtools.inspectedWindow.tabId;

const state = {
  capturing: true,
  tab: 'errors' as Tab,
  events: [] as CapturedEvent[],
  analyses: [] as AnalysisResult[],
  aiAnalyses: [] as AiAnalysis[],
  fixes: [] as AiFixSuggestion[],
  filters: {
    query: '',
    severity: 'all' as SeverityFilter,
    speed: 'all' as SpeedFilter,
    onlyIssues: false,
  },
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
const queryInput = document.getElementById('filter-query') as HTMLInputElement;
const severitySelect = document.getElementById('filter-severity') as HTMLSelectElement;
const speedSelect = document.getElementById('filter-speed') as HTMLSelectElement;
const issuesOnlyInput = document.getElementById('filter-issues') as HTMLInputElement;

document.querySelectorAll<HTMLButtonElement>('nav button').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.tab = (btn.dataset.tab ?? 'errors') as Tab;
    activateCurrentTab();
    render();
  });
});

queryInput.addEventListener('input', () => {
  state.filters.query = queryInput.value.trim().toLowerCase();
  render();
});

severitySelect.addEventListener('change', () => {
  state.filters.severity = severitySelect.value as SeverityFilter;
  render();
});

speedSelect.addEventListener('change', () => {
  state.filters.speed = speedSelect.value as SpeedFilter;
  render();
});

issuesOnlyInput.addEventListener('change', () => {
  state.filters.onlyIssues = issuesOnlyInput.checked;
  render();
});

(document.getElementById('btn-filter-clear') as HTMLButtonElement).addEventListener('click', () => {
  state.filters = { query: '', severity: 'all', speed: 'all', onlyIssues: false };
  queryInput.value = '';
  severitySelect.value = 'all';
  speedSelect.value = 'all';
  issuesOnlyInput.checked = false;
  render();
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
  statusLine.textContent = 'Captured data local engine ko bhej rahe hain';
  sendControl({ name: 'request-analysis' });
});

(document.getElementById('btn-heap') as HTMLButtonElement).addEventListener('click', () => {
  statusLine.textContent = 'Chrome Debugger se memory snapshot request ho raha hai';
  sendControl({ name: 'request-heap-snapshot' });
});

main.addEventListener('click', (ev) => {
  const target = ev.target;
  if (!(target instanceof HTMLElement)) return;
  const analysisId = target.dataset.fixAnalysisId;
  if (!analysisId) return;
  statusLine.textContent = 'Safe fix suggestion generate ho raha hai';
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
  const filtered = applyEventFilters(filterFor(state.tab));
  main.innerHTML = renderTab(state.tab, filtered);
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

function applyEventFilters(events: CapturedEvent[]): CapturedEvent[] {
  return events.filter((event) => {
    const severity = severityFor(event);
    if (state.filters.severity !== 'all' && state.filters.severity !== severity) return false;
    if (state.filters.onlyIssues && !isIssueEvent(event)) return false;
    if (state.filters.speed !== 'all' && !matchesSpeedFilter(event, state.filters.speed)) return false;
    if (state.filters.query && !eventSearchText(event).includes(state.filters.query)) return false;
    return true;
  });
}

function applyAnalysisFilters(results: AnalysisResult[]): AnalysisResult[] {
  return results.filter((result) => {
    if (state.filters.severity !== 'all' && state.filters.severity !== result.severity) return false;
    if (state.filters.onlyIssues && result.severity === 'info') return false;
    if (state.filters.query && !analysisSearchText(result).includes(state.filters.query)) return false;
    return true;
  });
}

function isIssueEvent(event: CapturedEvent): boolean {
  switch (event.source) {
    case 'error':
    case 'rejection':
    case 'dom-leak':
    case 'listener-leak':
    case 'heap-diff':
    case 'long-task':
    case 'layout-shift':
      return true;
    case 'console':
      return event.level === 'error' || event.level === 'warn';
    case 'fetch':
    case 'xhr':
      return event.kind === 'error' || (event.status ?? 0) >= 400 || (event.durationMs ?? 0) >= 1500;
    case 'fps':
      return event.fps < 30 || event.jankFrames > 0;
    case 'change-detection':
      return (event.cumulativeCount ?? 0) >= 100 || event.durationMs >= 16;
    case 'rxjs':
      return event.kind === 'leak-suspect';
    case 'zone':
      return event.durationMs >= 16;
    default:
      return false;
  }
}

function matchesSpeedFilter(event: CapturedEvent, speed: SpeedFilter): boolean {
  if (event.source !== 'fetch' && event.source !== 'xhr') return speed === 'all';
  if (event.kind !== 'response' && event.kind !== 'error') return speed === 'all';
  const ms = event.durationMs ?? 0;
  if (speed === 'failed') return event.kind === 'error' || (event.status ?? 0) >= 400;
  if (speed === 'slow') return ms >= 1500;
  if (speed === 'medium') return ms >= 500 && ms < 1500;
  if (speed === 'fast') return ms < 500 && event.kind === 'response' && (event.status ?? 0) < 400;
  return true;
}

function eventSearchText(event: CapturedEvent): string {
  const location = locationText(locationForEvent(event));
  return `${JSON.stringify(event)} ${explainEvent(event)} ${location}`.toLowerCase();
}

function analysisSearchText(result: AnalysisResult): string {
  return `${result.title} ${result.summary} ${result.detail ?? ''} ${result.detectorId} ${result.category} ${result.locations
    .map((loc) => `${loc.file} ${loc.symbol ?? ''}`)
    .join(' ')}`.toLowerCase();
}

function renderTab(tab: Tab, events: CapturedEvent[]): string {
  const intro = renderTabIntro(tab);
  if (tab === 'ai') return intro + renderToolbarHelp() + renderAnalyses();
  if (tab === 'fixes') return intro + renderToolbarHelp() + renderFixes(state.fixes);

  const rows = events
    .slice(-200)
    .reverse()
    .map((event) => renderRow(event))
    .join('');

  return intro + renderToolbarHelp() + (rows || renderEmpty(tab));
}

function renderTabIntro(tab: Tab): string {
  const copy: Record<Tab, { title: string; body: string; action: string }> = {
    errors: {
      title: 'Errors tab kya batata hai?',
      body: 'Yahan console warnings, console errors, uncaught JS errors, aur unhandled promise rejections aate hain. Red/high cheez ko pehle dekhna hota hai.',
      action: 'Agar webpack warning hai to usually build/performance warning hoti hai. Agar real error/rejection hai to stack trace ya component hint se source file dhoondo.',
    },
    network: {
      title: 'Network tab kya batata hai?',
      body: 'Yahan fetch/XHR API calls dikhte hain. Right side me status aur time hota hai. 200 success hai, 4xx/5xx problem hai, 1500ms se upar slow maana ja sakta hai.',
      action: 'Slow API ke liye backend latency, duplicate calls, payload size, cache, aur repeated polling check karo.',
    },
    angular: {
      title: 'Angular tab kya batata hai?',
      body: 'CD ka matlab Change Detection hai. Component name ke right me count/duration hota hai. Higher count ka matlab component baar-baar check/render path me aa raha hai.',
      action: 'High CD count par template function calls, missing trackBy, large ngFor, Default change detection, aur repeated inputs check karo.',
    },
    memory: {
      title: 'Memory tab kya batata hai?',
      body: 'Heap sample JS memory usage hai. Detached DOM ka matlab element page se remove hua par memory me reference bacha hai. Listener leak ka matlab listener add hua par cleanup doubtful hai.',
      action: 'Repeated detached DOM/listener growth dikhe to ngOnDestroy/DestroyRef cleanup, removeEventListener, observer.disconnect, timer clear, aur third-party component cleanup check karo.',
    },
    rxjs: {
      title: 'RxJS tab kya batata hai?',
      body: 'Yahan subscribe/unsubscribe lifecycle aur long-lived subscription suspects aate hain. Empty tab ka matlab abhi RxJS leak signal nahi mila.',
      action: 'Leak dikhe to async pipe, takeUntilDestroyed, shareReplay({ bufferSize: 1, refCount: true }), aur nested subscribe patterns check karo.',
    },
    performance: {
      title: 'Performance tab kya batata hai?',
      body: 'FPS low ho to UI lag karta hai. Long task ka matlab browser main thread busy tha. 50ms+ noticeable, 100ms+ serious, 500ms+ very serious.',
      action: 'Large lists, heavy table/grid rendering, scroll handlers, expensive pipes, chart/pdf libs, aur synchronous loops ko optimize karo.',
    },
    ai: {
      title: 'AI Suggestions tab kya batata hai?',
      body: 'Yahan detectors important findings ko issue cards me convert karte hain. Analyze dabane ke baad local engine AI/root-cause explanation add karta hai.',
      action: 'Sabse pehle high/critical cards dekho. Phir Analyze dabao. Jo component/file repeat ho raha hai usko priority do.',
    },
    fixes: {
      title: 'Auto Fixes tab kya batata hai?',
      body: 'Yahan generated patch preview aata hai. Safe fix tabhi hota hai jab deterministic ts-morph rule match kare. Review fix ka matlab manually verify karna zaroori hai.',
      action: 'Patch ko apply karne se pehle code samjho, tests chalao, aur unrelated code changes avoid karo.',
    },
  };
  const item = copy[tab];
  return `
    <section class="guide-card">
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.body)}</p>
      <p><span>Next:</span> ${escapeHtml(item.action)}</p>
    </section>`;
}

function renderToolbarHelp(): string {
  return `
    <details class="toolbar-help">
      <summary>Buttons, colors, shortcuts/terms ka matlab</summary>
      <div class="help-grid">
        <div><strong>Pause</strong><span>Capture temporarily stop. App chalti rahegi, bas new events record nahi honge.</span></div>
        <div><strong>Resume</strong><span>Pause ke baad capture dobara start.</span></div>
        <div><strong>Analyze</strong><span>Captured data local AI engine ko bhejta hai. Isse root-cause summary banti hai.</span></div>
        <div><strong>Heap</strong><span>Chrome Debugger se memory snapshot request. Heavy operation hai; baar-baar mat dabao.</span></div>
        <div><strong>Clear</strong><span>Current panel data clear. App ya engine reset nahi hota.</span></div>
        <div><strong>CD</strong><span>Change Detection. Angular component check/render path me aaya.</span></div>
        <div><strong>FPS</strong><span>Frames per second. 60 smooth, 30 low, 24 se neeche lag.</span></div>
        <div><strong>MS</strong><span>Milliseconds. 1000ms = 1 second.</span></div>
        <div><strong>MiB</strong><span>Memory unit. Heap memory kitni use ho rahi hai.</span></div>
        <div><strong>DOM</strong><span>Page ka HTML element tree.</span></div>
        <div><strong>XHR/fetch</strong><span>API request methods.</span></div>
        <div><strong>4xx/5xx</strong><span>4xx client/auth/request issue. 5xx backend/server issue.</span></div>
        <div><strong>Green</strong><span>Normal/fast/safe.</span></div>
        <div><strong>Yellow</strong><span>Warning/medium/slower. Watch karo.</span></div>
        <div><strong>Red</strong><span>High/failed/slow/serious. Priority do.</span></div>
      </div>
    </details>`;
}

function renderEmpty(tab: Tab): string {
  const empty: Record<Tab, string> = {
    errors: 'Abhi error/warning capture nahi hua. App me koi error trigger hoga to yahan dikhega.',
    network: 'Abhi API request capture nahi hui. Page reload ya app action karo, then requests yahan aayengi.',
    angular: 'Abhi Angular/change detection event nahi mila. Angular app reload karo ya UI interact karo.',
    memory: 'Abhi memory signal nahi mila. Thoda app use karo; heap samples kuch seconds me aate hain.',
    rxjs: 'Abhi RxJS leak signal nahi mila. Ye normal ho sakta hai.',
    performance: 'Abhi FPS/long-task signal nahi mila. Scroll/click/heavy action karoge to yahan data aayega.',
    ai: 'Analyze dabane ke baad findings yahan explain hongi.',
    fixes: 'AI suggestion se fix generate karoge to patch preview yahan aayega.',
  };
  return `<div class="empty">${escapeHtml(empty[tab])}</div>`;
}

function renderRow(event: CapturedEvent): string {
  const time = formatTime(event.pageTime);
  const sev = severityFor(event);
  const help = explainEvent(event);
  const location = locationForEvent(event);
  switch (event.source) {
    case 'fetch':
    case 'xhr':
      return row(
        time,
        networkBadgeClass(event),
        `<strong>${escapeHtml(event.method)}</strong> ${escapeHtml(event.url)}`,
        networkMeta(event),
        help,
        location,
      );
    case 'console':
      return row(time, event.level, escapeHtml(event.args.join(' ')), '', help, location);
    case 'error':
      return row(time, 'critical', escapeHtml(event.message), event.componentHint ?? '', help, location);
    case 'rejection':
      return row(time, 'high', escapeHtml(event.reason), event.origin ?? '', help, location);
    case 'angular':
      return row(
        time,
        'info',
        `Angular ${event.kind}`,
        event.version ?? (event.tree ? `${event.tree.length} root(s)` : ''),
        help,
        location,
      );
    case 'change-detection':
      return row(
        time,
        'info',
        event.componentName ? `CD ${escapeHtml(event.componentName)}` : 'CD tick',
        `${event.cumulativeCount ?? ''} / ${Math.round(event.durationMs)}ms`,
        help,
        location,
      );
    case 'zone':
      return row(
        time,
        'low',
        `Zone task ${escapeHtml(event.taskSource ?? '')}`,
        `${Math.round(event.durationMs)}ms`,
        help,
        location,
      );
    case 'rxjs':
      return row(
        time,
        'medium',
        `RxJS ${event.kind} #${event.subscriptionId}`,
        event.liveMs ? `${Math.round(event.liveMs)}ms` : '',
        help,
        location,
      );
    case 'dom-leak':
      return row(
        time,
        'high',
        `Detached DOM: ${event.detachedCount} nodes`,
        event.examples.map((item: { tag: string }) => item.tag).join(', '),
        help,
        location,
      );
    case 'listener-leak':
      return row(
        time,
        'medium',
        `Listener leak on ${escapeHtml(event.target)}.${escapeHtml(event.type)}`,
        `count=${event.count}, peak=${event.growth}`,
        help,
        location,
      );
    case 'memory':
      return row(
        time,
        'info',
        'Heap sample',
        `${(event.usedJsHeapSize / 1024 / 1024).toFixed(1)} MiB`,
        help,
        location,
      );
    case 'heap-diff':
      return row(
        time,
        'high',
        `Heap diff +${(event.retainedDeltaBytes / 1024 / 1024).toFixed(1)} MiB`,
        event.topSuspects.map((suspect: { className: string }) => suspect.className).slice(0, 3).join(', '),
        help,
        location,
      );
    case 'long-task':
      return row(time, event.durationMs >= 500 ? 'high' : 'medium', 'Long task', `${Math.round(event.durationMs)}ms`, help, location);
    case 'fps':
      return row(time, event.fps < 24 ? 'high' : event.fps < 45 ? 'medium' : 'fast', `FPS ${event.fps}`, `jank=${event.jankFrames}`, help, location);
    case 'layout-shift':
      return row(time, event.value >= 0.25 ? 'high' : 'medium', `Layout shift ${event.value.toFixed(3)}`, '', help, location);
  }
  return row(time, 'info', 'Unknown event', '', 'Unknown event type. Isko ignore kar sakte ho jab tak repeat na ho.', location);
}

function networkMeta(event: Extract<CapturedEvent, { source: 'fetch' | 'xhr' }>): string {
  if (event.kind === 'request') return 'PENDING';
  if (event.kind === 'error') return `FAILED / ${Math.round(event.durationMs ?? 0)}ms`;
  const ms = Math.round(event.durationMs ?? 0);
  const speed =
    ms >= 3000 ? 'VERY SLOW' : ms >= 1500 ? 'SLOW' : ms >= 500 ? 'MEDIUM' : 'FAST';
  return `${speed} ${event.status ?? '-'} / ${ms}ms`;
}

function networkBadgeClass(event: Extract<CapturedEvent, { source: 'fetch' | 'xhr' }>): string {
  if (event.kind === 'error' || (event.status ?? 0) >= 500) return 'critical';
  if ((event.status ?? 0) >= 400) return 'high';
  const ms = event.durationMs ?? 0;
  if (ms >= 3000) return 'critical';
  if (ms >= 1500) return 'high';
  if (ms >= 500) return 'medium';
  if (event.kind === 'response') return 'fast';
  return 'info';
}

function locationForEvent(event: CapturedEvent): DisplayLocation | undefined {
  switch (event.source) {
    case 'error':
      return fromFilename(event.filename, event.lineno, event.colno) ?? parseStackLocation(event.stack);
    case 'rejection':
      return parseStackLocation(event.stack);
    case 'console':
      return parseStackLocation(event.stack);
    case 'fetch':
    case 'xhr':
      return parseStackLocation(event.initiator?.stack);
    case 'change-detection':
      return event.componentName
        ? { file: '', symbol: event.componentName }
        : undefined;
    case 'rxjs':
      return parseStackLocation(event.createdAtStack);
    default:
      return undefined;
  }
}

function fromFilename(
  file: string | undefined,
  line: number | undefined,
  column: number | undefined,
): DisplayLocation | undefined {
  if (!file) return undefined;
  return { file: cleanupFile(file), ...(line ? { line } : {}), ...(column ? { column } : {}) };
}

function parseStackLocation(stack: string | undefined): DisplayLocation | undefined {
  if (!stack) return undefined;
  const lines = stack.split('\n').map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const withSymbol = /at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/.exec(line);
    if (withSymbol) {
      return {
        symbol: withSymbol[1],
        file: cleanupFile(withSymbol[2] ?? ''),
        line: Number(withSymbol[3]),
        column: Number(withSymbol[4]),
      };
    }
    const noSymbol = /at\s+(.+?):(\d+):(\d+)/.exec(line);
    if (noSymbol) {
      return {
        file: cleanupFile(noSymbol[1] ?? ''),
        line: Number(noSymbol[2]),
        column: Number(noSymbol[3]),
      };
    }
  }
  return undefined;
}

function cleanupFile(file: string): string {
  return file
    .replace(/^webpack:\/\//, '')
    .replace(/^ng:\/\//, '')
    .replace(/^file:\/\//, '')
    .replace(/\?.*$/, '');
}

function locationText(location: DisplayLocation | undefined): string {
  if (!location) return '';
  const file = location.file || '(file unknown)';
  const line = location.line ? `:${location.line}${location.column ? `:${location.column}` : ''}` : '';
  const symbol = location.symbol ? ` - ${location.symbol}` : '';
  return `${file}${line}${symbol}`;
}

function locationHelp(location: DisplayLocation | undefined): string {
  if (!location) {
    return 'Location: file/line available nahi. Analyze dabao ya Chrome Console stack/source maps check karo.';
  }
  if (!location.file && location.symbol) {
    return `Component: ${location.symbol}. File dhoondhne ke liye VS Code me component name search karo.`;
  }
  return `Location: ${locationText(location)}`;
}

function explainEvent(event: CapturedEvent): string {
  switch (event.source) {
    case 'fetch':
    case 'xhr': {
      if (event.kind === 'request') return 'Matlab: API call start hui. Ab response time aur status dekhna hai.';
      if (event.kind === 'error') return 'Matlab: API request fail hui. Network, CORS, URL, auth token, ya server down check karo.';
      const ms = event.durationMs ?? 0;
      if ((event.status ?? 0) >= 400) return 'Matlab: Server ne error status diya. Request payload, auth, endpoint aur backend logs check karo.';
      if (ms >= 1500) return 'Matlab: API successful hai but slow hai. Backend latency, duplicate call, cache, payload size check karo.';
      return 'Matlab: API successful aur normal speed me complete hui.';
    }
    case 'console':
      if (event.level === 'error') return 'Matlab: App ne console.error print kiya. Agar repeated hai to real bug ho sakta hai.';
      if (event.level === 'warn') return 'Matlab: Warning hai. App chal sakti hai, par performance/build/config issue ho sakta hai.';
      return 'Matlab: Console log/info hai. Usually low priority.';
    case 'error':
      return 'Matlab: JavaScript error uncaught chhuta. Stack/component hint se exact code location dhoondo.';
    case 'rejection':
      return 'Matlab: Promise reject hui aur catch nahi hui. async/await try-catch ya RxJS catchError add karo.';
    case 'angular':
      return 'Matlab: Angular app/runtime detect hua ya component tree snapshot mila.';
    case 'change-detection':
      if (event.kind === 'tick') return 'Matlab: Angular ka global change detection cycle chala.';
      return 'Matlab: CD = Change Detection. Count high hai to component baar-baar check/render path me aa raha hai.';
    case 'zone':
      return 'Matlab: Zone.js async task track hua. requestAnimationFrame/message/setTimeout repeat ho rahe hain to CD trigger ho sakta hai.';
    case 'rxjs':
      if (event.kind === 'leak-suspect') return 'Matlab: Subscription long time tak alive hai. takeUntilDestroyed ya async pipe check karo.';
      return 'Matlab: RxJS subscription lifecycle event capture hua.';
    case 'dom-leak':
      return 'Matlab: DOM nodes remove ho gaye par memory me reference bacha ho sakta hai. Cleanup missing suspect hai.';
    case 'listener-leak':
      return 'Matlab: Event listeners ka count grow hua. removeEventListener ya DestroyRef cleanup check karo.';
    case 'memory':
      return 'Matlab: JS heap memory sample. Agar continuously grow kare aur down na aaye to memory leak suspect hai.';
    case 'heap-diff':
      return 'Matlab: Do heap snapshots ke beech retained memory badhi. Top retainers inspect karo.';
    case 'long-task':
      return 'Matlab: Browser main thread block hua. 100ms+ serious; heavy loop/rendering/filtering suspect hai.';
    case 'fps':
      if (event.fps < 24) return 'Matlab: UI lag/jank ho raha hai. Large list, scroll handler, animations, heavy CD check karo.';
      return 'Matlab: Frame rate currently okay hai.';
    case 'layout-shift':
      return 'Matlab: Page layout shift hua. Image/iframe/font/async component ke dimensions reserve karo.';
  }
}

function renderAnalyses(): string {
  const visible = applyAnalysisFilters(state.analyses);
  if (visible.length === 0) {
    return '<div class="empty">Abhi koi detector finding nahi hai. App use karo, phir Analyze dabao.</div>';
  }

  const aiByResult = new Map(state.aiAnalyses.map((analysis) => [analysis.resultId, analysis]));
  return visible
    .map((result) => {
      const ai = aiByResult.get(result.id);
      const actions =
        ai?.recommendedActions.map((action: string) => `<li>${escapeHtml(action)}</li>`).join('') ??
        '';
      const help = explainAnalysis(result);
      const locations = renderAnalysisLocations(result);
      return `
    <div class="ai-card">
      <h3><span class="badge ${result.severity}">${result.severity}</span> ${escapeHtml(result.title)}</h3>
      <p>${escapeHtml(result.summary)}</p>
      ${locations}
      <div class="explain-box">
        <strong>Hinglish samjho:</strong>
        <p>${escapeHtml(help.meaning)}</p>
        <p><span>Kaise fix/check kare:</span> ${escapeHtml(help.next)}</p>
      </div>
      ${result.detail ? `<pre>${escapeHtml(result.detail)}</pre>` : ''}
      ${
        ai
          ? `<p><strong>${escapeHtml(ai.headline)}</strong></p>
             <p>${escapeHtml(ai.rootCause)}</p>
             <p>${escapeHtml(ai.explanation)}</p>
             <ol>${actions}</ol>
             <button type="button" data-fix-analysis-id="${escapeHtml(ai.id)}">Generate safe fix</button>`
          : '<p class="meta">Detector result live hai. Analyze dabao to AI/root-cause explanation add hogi.</p>'
      }
      <div class="meta">confidence ${Math.round(result.confidence * 100)}% / occurrences ${result.occurrences} / detector ${escapeHtml(result.detectorId)}</div>
    </div>`;
    })
    .join('');
}

function renderAnalysisLocations(result: AnalysisResult): string {
  const known = result.locations.filter((loc) => loc.file || loc.symbol);
  if (known.length === 0) {
    return `
      <div class="location-card warn">
        <strong>File/line:</strong>
        Abhi exact file/line nahi mila. Reason: stack trace/source map available nahi tha ya detector component-level signal de raha hai.
        VS Code me component/API/error text search karo, ya Analyze dabao for better root-cause context.
      </div>`;
  }
  return `
    <div class="location-card">
      <strong>Possible location:</strong>
      ${known
        .map((loc) =>
          escapeHtml(
            `${loc.file || '(file unknown)'}${loc.line ? `:${loc.line}${loc.column ? `:${loc.column}` : ''}` : ''}${loc.symbol ? ` - ${loc.symbol}` : ''}`,
          ),
        )
        .join('<br />')}
    </div>`;
}

function explainAnalysis(result: AnalysisResult): { meaning: string; next: string } {
  switch (result.category) {
    case 'slow-api':
      return {
        meaning: 'API response slow aa raha hai. User ko loading/lag feel ho sakta hai.',
        next: 'Endpoint ko Network tab me open karke duration, duplicate calls, payload size, backend logs, cache check karo.',
      };
    case 'duplicate-request':
      return {
        meaning: 'Same API baar-baar fire ho rahi hai. Usually duplicate subscription, polling, ya template se new Observable ban raha hota hai.',
        next: 'shareReplay({ bufferSize: 1, refCount: true }), async pipe, caching, aur repeated click/route logic check karo.',
      };
    case 'runtime-error':
    case 'unhandled-rejection':
      return {
        meaning: 'Code me error throw/reject hua aur handle nahi hua. User flow break ho sakta hai.',
        next: 'Stack trace se file/component dhoondo. try-catch, catchError, null checks, aur error UI add karo.',
      };
    case 'change-detection-storm':
    case 'expensive-template':
    case 'missing-track-by':
      return {
        meaning: 'Angular component bahut baar change detection/render path me aa raha hai. Large list me ye UI slow kar sakta hai.',
        next: 'Template function calls remove karo, trackBy add karo, OnPush use karo, list virtual scroll/pagination check karo.',
      };
    case 'rxjs-leak':
      return {
        meaning: 'RxJS subscription destroy ke baad bhi alive reh sakti hai. Memory leak ya duplicate API issue aa sakta hai.',
        next: 'subscribe ko async pipe se replace karo ya takeUntilDestroyed(inject(DestroyRef)) use karo.',
      };
    case 'detached-dom':
    case 'listener-leak':
    case 'heap-growth':
      return {
        meaning: 'Memory cleanup suspicious hai. DOM/listener/object references destroy ke baad bhi retained ho sakte hain.',
        next: 'ngOnDestroy/DestroyRef me removeEventListener, observer.disconnect, clearInterval, third-party destroy cleanup check karo.',
      };
    case 'long-task':
    case 'low-fps':
    case 'layout-thrash':
      return {
        meaning: 'Rendering/performance issue hai. Main thread block ya FPS drop user ko lag dikhata hai.',
        next: 'Heavy loops, table rendering, scroll handlers, images/fonts dimensions, animations, expensive CSS aur pipes optimize karo.',
      };
  }
}

function renderFixes(fixes: AiFixSuggestion[]): string {
  if (fixes.length === 0) {
    return '<div class="empty">AI Suggestions me Analyze ke baad fix generate karoge to patch preview yahan dikhega.</div>';
  }
  return fixes
    .map(
      (fix) => `
    <div class="fix-card">
      <h3><span class="badge ${fix.autoApplicable ? 'low' : 'medium'}">${fix.autoApplicable ? 'safe' : 'review'}</span> ${escapeHtml(fix.title)}</h3>
      <div class="explain-box">
        <strong>Hinglish samjho:</strong>
        <p>${escapeHtml(fix.autoApplicable ? 'Ye deterministic safe-fix rule se bana hai, phir bhi apply se pehle code review karo.' : 'Ye review-needed suggestion hai. Direct apply mat karo jab tak code samajh na aa jaye.')}</p>
      </div>
      <p>${escapeHtml(fix.autoApplicableReason)}</p>
      <pre>${escapeHtml(fix.diff || fix.body)}</pre>
      <div class="meta">model ${escapeHtml(fix.model)}${fix.files?.length ? ` / ${fix.files.map(escapeHtml).join(', ')}` : ''}</div>
    </div>`,
    )
    .join('');
}

function row(
  time: string,
  sev: string,
  title: string,
  meta: string,
  help: string,
  location?: DisplayLocation,
): string {
  return `
    <div class="row">
      <span class="meta">${time}</span>
      <div class="row-content">
        <div class="row-title">${title}</div>
        <div class="row-help">${escapeHtml(help)}</div>
        <div class="row-location">${escapeHtml(locationHelp(location))}</div>
      </div>
      <span class="badge ${sev}">${escapeHtml(meta || sev)}</span>
    </div>`;
}

function severityFor(event: CapturedEvent): string {
  switch (event.source) {
    case 'fetch':
    case 'xhr':
      return networkBadgeClass(event);
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
