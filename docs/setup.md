# Setup Guide

## Prerequisites

- Node.js 20.11 or newer. This workspace was verified on Node `v24.13.1`.
- npm 10 or newer.
- Chrome or Chromium with extension developer mode enabled.
- Optional: Mistral API key or a local Ollama server.

## Install And Build

```powershell
npm install
npm run typecheck
npm run build
npm run test
```

The Chrome extension output is:

```text
apps/extension/dist
```

## Configure AI

Create `apps/ai-engine/.env` from `apps/ai-engine/.env.example`.

For Mistral:

```text
AI_PROVIDER=mistral
MISTRAL_API_KEY=<your key>
```

For local Ollama:

```text
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_ROOT_CAUSE_MODEL=qwen2.5-coder:14b
OLLAMA_FIX_MODEL=qwen2.5-coder:14b
```

For offline heuristic mode:

```text
AI_PROVIDER=heuristic
```

Do not commit `.env`. It is already ignored.

## Start The Local Engine

```powershell
npm run start -w @angular-ai-debugger/ai-engine
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:5757/health
```

## Load The Chrome Extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select `apps/extension/dist`.
5. Open DevTools on an Angular app.
6. Open the `Abid Debugger` tab.

## Normal Debugging Flow

1. Load the inspected Angular app.
2. Keep the AI engine running locally.
3. Open the `Abid Debugger` DevTools panel.
4. Reproduce the issue.
5. Use tabs for live Errors, Network, Angular, Memory, RxJS, and Performance telemetry.
6. Click `Analyze` to generate root-cause suggestions.
7. Click `Heap` to request a Chrome Debugger heap snapshot.
8. Generate safe fixes from AI suggestions when a deterministic auto-fix rule applies.

## Reports

After analysis persists a session, generate reports with:

```powershell
npm run report -w @angular-ai-debugger/ai-engine -- --session <session-id>
```

Reports are written to `apps/ai-engine/data/reports/<session-id>/`.
