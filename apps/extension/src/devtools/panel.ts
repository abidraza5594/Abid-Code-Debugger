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
  const filtered = filterFor(state.tab);
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

function renderTab(tab: Tab, events: CapturedEvent[]): string {
  const intro = renderTabIntro(tab);
  if (tab === 'ai') return intro + renderAnalyses();
  if (tab === 'fixes') return intro + renderFixes(state.fixes);

  const rows = events
    .slice(-200)
    .reverse()
    .map((event) => renderRow(event))
    .join('');

  return intro + (rows || renderEmpty(tab));
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
        help,
      );
    case 'console':
      return row(time, event.level, escapeHtml(event.args.join(' ')), '', help);
    case 'error':
      return row(time, 'critical', escapeHtml(event.message), event.componentHint ?? '', help);
    case 'rejection':
      return row(time, 'high', escapeHtml(event.reason), event.origin ?? '', help);
    case 'angular':
      return row(
        time,
        'info',
        `Angular ${event.kind}`,
        event.version ?? (event.tree ? `${event.tree.length} root(s)` : ''),
        help,
      );
    case 'change-detection':
      return row(
        time,
        'info',
        event.componentName ? `CD ${escapeHtml(event.componentName)}` : 'CD tick',
        `${event.cumulativeCount ?? ''} / ${Math.round(event.durationMs)}ms`,
        help,
      );
    case 'zone':
      return row(
        time,
        'low',
        `Zone task ${escapeHtml(event.taskSource ?? '')}`,
        `${Math.round(event.durationMs)}ms`,
        help,
      );
    case 'rxjs':
      return row(
        time,
        'medium',
        `RxJS ${event.kind} #${event.subscriptionId}`,
        event.liveMs ? `${Math.round(event.liveMs)}ms` : '',
        help,
      );
    case 'dom-leak':
      return row(
        time,
        'high',
        `Detached DOM: ${event.detachedCount} nodes`,
        event.examples.map((item: { tag: string }) => item.tag).join(', '),
        help,
      );
    case 'listener-leak':
      return row(
        time,
        'medium',
        `Listener leak on ${escapeHtml(event.target)}.${escapeHtml(event.type)}`,
        `count=${event.count}, peak=${event.growth}`,
        help,
      );
    case 'memory':
      return row(
        time,
        'info',
        'Heap sample',
        `${(event.usedJsHeapSize / 1024 / 1024).toFixed(1)} MiB`,
        help,
      );
    case 'heap-diff':
      return row(
        time,
        'high',
        `Heap diff +${(event.retainedDeltaBytes / 1024 / 1024).toFixed(1)} MiB`,
        event.topSuspects.map((suspect: { className: string }) => suspect.className).slice(0, 3).join(', '),
        help,
      );
    case 'long-task':
      return row(time, 'medium', 'Long task', `${Math.round(event.durationMs)}ms`, help);
    case 'fps':
      return row(time, event.fps < 30 ? 'high' : 'info', `FPS ${event.fps}`, `jank=${event.jankFrames}`, help);
    case 'layout-shift':
      return row(time, 'medium', `Layout shift ${event.value.toFixed(3)}`, '', help);
  }
  return row(time, 'info', 'Unknown event', '', 'Unknown event type. Isko ignore kar sakte ho jab tak repeat na ho.');
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
  if (state.analyses.length === 0) {
    return '<div class="empty">Abhi koi detector finding nahi hai. App use karo, phir Analyze dabao.</div>';
  }

  const aiByResult = new Map(state.aiAnalyses.map((analysis) => [analysis.resultId, analysis]));
  return state.analyses
    .map((result) => {
      const ai = aiByResult.get(result.id);
      const actions =
        ai?.recommendedActions.map((action: string) => `<li>${escapeHtml(action)}</li>`).join('') ??
        '';
      const help = explainAnalysis(result);
      return `
    <div class="ai-card">
      <h3><span class="badge ${result.severity}">${result.severity}</span> ${escapeHtml(result.title)}</h3>
      <p>${escapeHtml(result.summary)}</p>
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

function row(time: string, sev: string, title: string, meta: string, help: string): string {
  return `
    <div class="row">
      <span class="meta">${time}</span>
      <div class="row-content">
        <div class="row-title">${title}</div>
        <div class="row-help">${escapeHtml(help)}</div>
      </div>
      <span class="badge ${sev}">${escapeHtml(meta || sev)}</span>
    </div>`;
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
