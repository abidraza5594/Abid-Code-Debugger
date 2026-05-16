# Security model

## Threat surface

1. **Inspected page** — runs arbitrary third-party JS. Any data we read from it is potentially malicious. We never `eval` page content, never JSON-parse the entire response body, and bound every body preview to 4 KiB.
2. **Page → extension postMessage bridge** — anyone on the page can post a message tagged with our bridge id. The content-script forwards only messages whose `tag === '__angular_ai_debugger__'` and whose `envelope.source !== 'page'` to avoid echoing our own messages back. The envelope is otherwise treated as untrusted input by the engine (no `eval`, no dynamic require).
3. **Background ↔ engine WebSocket** — bound to `127.0.0.1` and only the local engine accepts connections. The dev port is `5758`.
4. **Engine → Mistral** — encrypted HTTPS to Mistral's API. Outbound payloads are sanitized via `redactJsonShape` before being included in any prompt context.

## What we redact

- HTTP headers whose name appears in `SENSITIVE_HEADER_NAMES` (`authorization`, `cookie`, `set-cookie`, `x-csrf-token`, `x-api-key`, …).
- JSON keys matching `(password|passwd|secret|token|api[_-]?key|authorization|auth|session)` at any depth up to 6 (depth-capped for cost).
- Request and response bodies for URLs matching `/oauth/`, `/login/`, `/auth/`, `/token/`.
- Listener tracker never logs the listener function body.
- Console preview is depth-bounded (`PREVIEW_DEPTH=3`) and length-bounded (`PREVIEW_MAX_STR=512`).

## What we never touch

- `document.cookie` and the cookie store API.
- `localStorage` keys matching the sensitive regex (Mistral never sees them).
- Form fields with `type="password"`.
- Chrome credentials, autofill, or the password manager.

## Chrome permissions

| Permission | Why we need it |
|------------|----------------|
| `scripting` | Inject the MAIN-world bundle into the inspected page. |
| `debugger` | Attach CDP to the active tab on user request for HeapProfiler. |
| `storage` | Persist per-tab session ids across service-worker restarts. |
| `tabs` | Map devtools.inspectedWindow.tabId → background session. |
| `<all_urls>` host permission | Required so the extension can attach to any Angular app the user opens. Activity is gated by user opening the DevTools panel. |

## Mistral pinning

The Mistral SDK is pinned to `2.2.1` via `pnpm.overrides` in the root `package.json`. Versions 2.2.2 – 2.2.4 contain the Mini-Shai-Hulud dropper (advisory `GHSA-jgg6-4rpr-wfh7`). A bumped pin should always confirm the changelog / GHSA before adopting.

## What lands on disk

| File | Path | Sensitive? |
|------|------|-----------|
| `engine.db` | `apps/ai-engine/data/engine.db` | Analysis results, AI explanations. Body previews are already redacted. |
| `reports/<id>/report.*` | `apps/ai-engine/data/reports/<id>/` | Same as engine.db, plus HTML rendering. |
| `.env` | `apps/ai-engine/.env` | API key. Gitignored. |
