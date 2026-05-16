# File Map

## Root

- `package.json`: npm workspace scripts for install, build, typecheck, test, and clean.
- `package-lock.json`: locked dependency graph from `npm install`.
- `pnpm-workspace.yaml`: pnpm-compatible workspace declaration for teams that prefer pnpm.
- `tsconfig.base.json`: strict shared TypeScript configuration.
- `.gitignore`: ignores local secrets, build output, dependencies, and engine runtime data.

## Extension

- `apps/extension/package.json`: extension build and typecheck scripts.
- `apps/extension/scripts/build-extension.mjs`: esbuild bundler for background, content, injected, and DevTools entries.
- `apps/extension/tsconfig.json`: Chrome/DOM TypeScript config.
- `apps/extension/public/manifest.json`: Manifest V3 declaration.
- `apps/extension/public/devtools/devtools.html`: DevTools bootstrap page.
- `apps/extension/public/devtools/panel.html`: DevTools panel document.
- `apps/extension/public/devtools/panel.css`: production panel styling.
- `apps/extension/public/icons/*.svg`: extension and DevTools icons.
- `apps/extension/src/shared/runtime.ts`: `uid` and bounded `RingBuffer`.
- `apps/extension/src/background/service-worker.ts`: tab sessions, buffering, WebSocket bridge, Chrome Debugger heap capture.
- `apps/extension/src/content/content-script.ts`: isolated-world bridge and MAIN-world script injection.
- `apps/extension/src/content/inject.ts`: injected runtime entrypoint.
- `apps/extension/src/injected/**`: browser collectors for console, errors, network, Angular, RxJS, memory, DOM, and rendering.
- `apps/extension/src/devtools/panel.ts`: typed live panel state, tabs, AI analysis rendering, and fix preview.
- `apps/extension/src/devtools/devtools.ts`: registers the `Abid Debugger` DevTools tab.

## AI Engine

- `apps/ai-engine/.env.example`: provider, model, port, storage, and limit settings.
- `apps/ai-engine/src/index.ts`: HTTP and WebSocket server entrypoint.
- `apps/ai-engine/src/config.ts`: typed environment config.
- `apps/ai-engine/src/ai/client.ts`: Mistral/Ollama provider abstraction.
- `apps/ai-engine/src/server/websocket.ts`: live engine protocol and control command handling.
- `apps/ai-engine/src/server/session-manager.ts`: per-session detector pipelines and event buffers.
- `apps/ai-engine/src/server/http.ts`: health and session APIs.
- `apps/ai-engine/src/analyzers/**`: detector pipeline, evidence builders, root-cause synthesis, and built-in detectors.
- `apps/ai-engine/src/auto-fix/**`: deterministic ts-morph safe-fix rules and AI patch fallback.
- `apps/ai-engine/src/mistral/**`: Mistral schemas, prompts, and client wrapper.
- `apps/ai-engine/src/reports/**`: HTML, Markdown, and JSON report writer.
- `apps/ai-engine/src/storage/sqlite.ts`: SQLite persistence layer.
- `apps/ai-engine/src/__tests__/evidence.test.ts`: unit tests for evidence generation.

## Packages

- `packages/shared-types/src/index.ts`: shared captured event union, envelopes, detector API, analysis types, and helpers.
- `packages/angular-detectors/src/index.ts`: extension point for Angular detector plugins.
- `packages/memory-detectors/src/index.ts`: extension point for memory detector plugins.
- `packages/network-detectors/src/index.ts`: extension point for network detector plugins.
- `packages/performance-detectors/src/index.ts`: extension point for rendering/performance detector plugins.
- `packages/rxjs-detectors/src/index.ts`: extension point for RxJS detector plugins.
