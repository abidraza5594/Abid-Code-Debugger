# Production Deployment Guide

## Chrome Extension

1. Run `npm run build`.
2. Inspect `apps/extension/dist/manifest.json`.
3. Load `apps/extension/dist` in Chrome and run a smoke test against a local Angular app.
4. Package `apps/extension/dist` as the release artifact.

The extension uses Manifest V3, a background service worker, a DevTools page, and one content script. The inspected-page runtime is injected as a web-accessible module so it can access Angular globals such as `window.ng`.

## Local AI Engine

The engine is intended to run on a developer machine, bound to loopback.

```powershell
npm run build -w @angular-ai-debugger/ai-engine
npm run start -w @angular-ai-debugger/ai-engine
```

Default ports:

- HTTP: `127.0.0.1:5757`
- WebSocket: `127.0.0.1:5758`

Override with `HTTP_PORT` and `WS_PORT` in `apps/ai-engine/.env`.

## Secret Handling

- Store API keys only in `apps/ai-engine/.env`.
- Never hardcode keys in extension code.
- Prefer `AI_PROVIDER=ollama` for fully local analysis.
- When using Mistral, only redacted telemetry and bounded evidence are sent.

## Verification Checklist

Run before shipping:

```powershell
npm run typecheck
npm run build
npm run test
npm audit --omit=dev
```

Manual smoke test:

1. Start the engine.
2. Load the unpacked extension.
3. Open an Angular app.
4. Trigger a console error and a slow API request.
5. Confirm live events appear in DevTools.
6. Click `Analyze` and confirm structured AI or heuristic output.
7. Click `Heap` and confirm Chrome prompts for debugger access.

## Operational Notes

- Raw event buffers are memory capped.
- SQLite data and reports live under `apps/ai-engine/data`.
- The extension can continue showing live telemetry when the AI engine is offline.
- AI failures fall back to deterministic heuristic analysis.
