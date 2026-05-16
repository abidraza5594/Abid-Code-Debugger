# Architecture

## Goals

1. **Local-first.** Nothing leaves the developer's machine without an explicit Mistral API key.
2. **Plugin-based.** A new detector or auto-fix rule should be a single TypeScript file dropped into `packages/*-detectors` or `apps/ai-engine/src/auto-fix/rules/`.
3. **Replaceable AI provider.** The Mistral client is one file (`apps/ai-engine/src/mistral/client.ts`); the rest of the engine talks to it through a narrow surface (`rootCause`, `fixPatch`, `classifyNoise`).

## Boundaries

```
inspected page          extension (Chrome)             engine (Node)
─────────────         ───────────────────────         ────────────────
MAIN world            ISOLATED world                  WebSocket :5758
↓                     ↓                               ↓
inject.ts             content-script                  websocket.ts
  bridge              (transport only)                  ↓
  interceptors          ↓                             SessionManager
  Angular hooks       chrome.runtime.sendMessage        ↓
                        ↓                             Pipeline (per session)
                      service-worker.ts                 ↓
                        - per-tab event ring          detectors (heuristic)
                        - CDP attach (heap)             ↓
                        - WS bridge                   AnalysisResult[]
                                                        ↓
                                                      RootCauseAnalyzer
                                                        - Mistral large-3
                                                        - heuristic fallback
                                                        ↓
                                                      AiAnalysis
                                                        ↓
                                                      FixOrchestrator
                                                        - ts-morph rules first
                                                        - Mistral codestral
                                                        ↓
                                                      AiFixSuggestion (+ diff)
```

## Why MAIN-world injection

Angular's debug surface (`window.ng`, `getAllAngularRootElements`) is only available to scripts running in the page's JavaScript realm. Content scripts run in an isolated realm by default — they can read DOM but not page globals. Hence the two-layer approach: a content script (ISOLATED) loads a small bootstrap that injects the real interceptor bundle (MAIN) via a `<script>` tag, then the two communicate via `window.postMessage`.

## Backpressure

Each session keeps a 10 000-event ring buffer in the background service worker; older events drop on overflow. Every detector receives batches (250ms or 200 events) rather than per-event callbacks so the JS engine has a chance to GC between bursts. The engine likewise caps stored events at 30 000 per session.

## Mistral usage

| Call site | Model | Output |
|-----------|-------|--------|
| `RootCauseAnalyzer.analyze` | `mistral-large-3-25-12` | structured `RootCauseAnalysis` via Zod schema |
| `FixOrchestrator.suggestFor` | `codestral-25-08` | structured `FixSuggestion` (unified diff in `diff` field) |
| (planned) classifier | `ministral-3-8b-25-12` | `ClassifyNoise` |

Each call uses `client.chat.parse(...)` with the corresponding Zod schema — this is more reliable than plain JSON mode and gives us typed responses at compile time.

The Mistral SDK is pinned to `2.2.1` in the root `package.json` `pnpm.overrides`. Versions 2.2.2 – 2.2.4 contain the May-2026 Mini-Shai-Hulud dropper (`GHSA-jgg6-4rpr-wfh7`).

## Failure modes

- **No API key.** The engine returns `heuristicAnalysis(result)` from `analyzers/heuristic-fallback.ts`. Output remains structured and useful.
- **Mistral 429 / 5xx.** The SDK's `retryConfig: { strategy: 'backoff', maxElapsedTime: 30_000 }` covers transient errors. Hard failures fall back to heuristic output and emit a warning to the logger.
- **Schema parse failure.** `client.chat.parse(...)` throws; we log and fall back to heuristic.
- **CDP attach denied.** Heap snapshots fail silently; everything else continues.
- **Extension service worker terminated.** On reconnect the panel sends a `register` envelope, the background flushes its buffer, the engine de-dupes by `seq`.

## Storage

Events: in-memory only.
Sessions, AnalysisResults, AiAnalyses: SQLite at `apps/ai-engine/data/engine.db` (WAL mode).
Reports: filesystem at `apps/ai-engine/data/reports/<sessionId>/{report.html, report.md, report.json}`.

## Adding a new detector

1. Create `packages/<topic>-detectors/src/<name>.ts` implementing the `Detector` interface from `@angular-ai-debugger/shared-types`.
2. Add it to the array returned by `loadBuiltInDetectors()` in `apps/ai-engine/src/analyzers/detectors/index.ts`.
3. (Optional) Pair it with a fix rule under `apps/ai-engine/src/auto-fix/rules/` and add its category to that rule's `appliesTo`.

## Adding a new auto-fix rule

1. Create `apps/ai-engine/src/auto-fix/rules/<name>.ts` implementing the `FixRule` interface.
2. Register it in `apps/ai-engine/src/auto-fix/engine.ts` `RULES`.
3. Tag the analysis categories it handles in `appliesTo`.
