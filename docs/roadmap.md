# Roadmap

## Now (v0.1)

- Chrome MV3 extension with DevTools panel.
- Page-injected interceptors: fetch, XHR, console, errors, RxJS, MutationObserver, listener tracking, FPS, long-task, layout-shift, memory sampler.
- Angular runtime hooks: probe, Zone profiler, ApplicationRef.tick patch, change-detection sampler, component tree snapshot.
- Local Node + Express + WebSocket AI engine.
- Mistral integration: multi-model pipeline (Large 3 + Codestral + Devstral + Ministral) with structured outputs via `client.chat.parse(...)`.
- Heuristic fallback when no API key is configured.
- ts-morph auto-fix rules: `takeUntilDestroyed`, `trackBy`, `async-pipe` extraction.
- SQLite persistence + HTML / Markdown / JSON reports.

## Next (v0.2)

- Standalone Angular dashboard mirroring the DevTools panel.
- CDP-driven heap snapshot diffing in the engine (parse `.heapsnapshot` files, surface retainer trees).
- Source-map resolution for stack traces inside the engine (load app source maps over HTTP).
- Streaming AI responses via WebSocket (Mistral's `chat.stream(...)`).
- Auto-fix preview that applies the patch to a worktree without touching the original tree.

## Later (v0.3+)

- React + Vue support: replace the Angular detector with a framework-aware probe and reuse the rest of the pipeline.
- CI integration: a headless mode that runs the page under Playwright, drives a script, and emits a report — wireable into GitHub Actions.
- GitHub PR comments via the gh CLI / a GitHub App.
- VS Code extension that consumes engine reports and offers auto-fix from the gutter.
- Lighthouse + Web Vitals correlation in the dashboard.
- Optional Electron desktop wrapper for non-DevTools observation (e.g. running long sessions in the background).

## Out of scope for v0.x

- Production telemetry agent (we are a developer tool, not an RUM).
- Server-side rendering instrumentation.
