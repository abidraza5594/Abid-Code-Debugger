# Architecture

## Product Boundary

Abid Debugger is a local-first Chrome DevTools extension plus Node.js AI engine.

```
Angular app page
  |
  | MAIN world injected runtime
  | - fetch / XHR interceptors
  | - console / error hooks
  | - Angular runtime probes
  | - RxJS lifecycle tracker
  | - PerformanceObserver / RAF / MutationObserver
  v
Content script bridge
  |
  | chrome.runtime messages
  v
MV3 background service worker
  |
  | WebSocket ws://127.0.0.1:5758
  v
Local AI engine
  |
  | Detector pipeline -> root-cause synthesis -> safe fix suggestions
  v
SQLite store + HTML / Markdown / JSON reports
```

## Workspace Layout

```
apps/
  extension/       Chrome MV3 extension, DevTools panel, page injected collectors.
  ai-engine/       Express + WebSocket local engine, detectors, AI providers, reports.

packages/
  shared-types/    Shared event, message, detector, analysis, and fix contracts.
  angular-detectors/
  memory-detectors/
  network-detectors/
  performance-detectors/
  rxjs-detectors/
```

## Runtime Data Flow

1. `content-script.ts` runs at `document_start` in Chrome's isolated world.
2. It injects `content/inject.js` into the page's MAIN world.
3. MAIN-world collectors emit typed `CapturedEvent` objects through `bridge.ts`.
4. The content script forwards envelopes to the MV3 background worker.
5. The background worker buffers per-tab events, forwards live events to the DevTools panel, and streams them to the local engine.
6. The engine routes event batches through a plugin-style detector pipeline.
7. Detector findings are shown live in DevTools and persisted when analysis is requested.
8. The AI provider receives redacted evidence and returns root-cause analysis.
9. Auto-fix first tries deterministic `ts-morph` rules, then asks the configured AI provider for review-only patches.

## AI Providers

The engine is provider-gated by `AI_PROVIDER`:

- `mistral`: uses `MISTRAL_API_KEY` and structured Mistral outputs.
- `ollama`: uses local `OLLAMA_BASE_URL` and JSON-mode chat responses.
- `heuristic`: disables external AI and returns deterministic fallback guidance.

No API key is stored in source. Put secrets in `apps/ai-engine/.env`, which is gitignored.

## Detector Interface

```ts
export interface Detector {
  id: string;
  name: string;
  consumes: CapturedEventSource[];
  setup(ctx: DetectorContext): Promise<void> | void;
  analyze(events: CapturedEvent[], ctx: DetectorContext): Promise<AnalysisResult[]> | AnalysisResult[];
  finalize(ctx: DetectorContext): Promise<AnalysisResult[]> | AnalysisResult[];
  cleanup(ctx: DetectorContext): Promise<void> | void;
}
```

The current built-ins cover:

- Slow API calls.
- Duplicate or polling requests.
- Runtime errors and unhandled rejections.
- Angular change-detection storms.
- Hot component rerender signals.
- RxJS long-lived subscription suspects.
- Detached DOM and listener leaks.
- Long tasks, low FPS, and layout shift.

## Security Model

- Extension activity is gated by opening the DevTools panel.
- The AI engine binds to loopback only.
- Request headers and JSON fields matching credential patterns are redacted before leaving the page.
- Password fields, cookies, and browser credentials are never read.
- Heap snapshots require the user-triggered DevTools `Heap` action because Chrome displays debugger permission prompts.

## Persistence

The engine persists sessions, detector results, and AI analyses to SQLite at:

```
apps/ai-engine/data/engine.db
```

Reports are written under:

```
apps/ai-engine/data/reports/<sessionId>/
```
