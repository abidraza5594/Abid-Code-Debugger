# Security Model

## Local-First Principle

The extension captures developer telemetry from the inspected tab and sends it only to the local engine at `127.0.0.1` by default. External AI calls happen only when an AI provider is explicitly configured.

Supported modes:

- `AI_PROVIDER=heuristic`: no external AI calls.
- `AI_PROVIDER=ollama`: local Ollama HTTP calls only.
- `AI_PROVIDER=mistral`: sends redacted evidence to Mistral over HTTPS.

## Sensitive Data Redaction

The injected runtime redacts:

- Credential-like headers: `authorization`, `cookie`, `set-cookie`, `x-csrf-token`, `x-xsrf-token`, `x-api-key`, `x-auth-token`.
- JSON fields matching password, secret, token, api key, authorization, auth, or session patterns.
- Request and response body previews for auth-like URLs such as `/login`, `/auth`, `/oauth`, and `/token`.

All body previews are bounded to 4 KiB before being forwarded.

## Data Never Collected

The runtime does not intentionally read:

- `document.cookie`.
- Browser password manager data.
- Password form field values.
- Full localStorage/sessionStorage dumps.
- Listener function bodies.

## Chrome Permissions

| Permission | Purpose |
| --- | --- |
| `scripting` | Inject the MAIN-world runtime into the inspected page. |
| `debugger` | Attach Chrome DevTools Protocol on explicit heap snapshot request. |
| `storage` | Keep session metadata across MV3 service-worker restarts. |
| `tabs` | Map the DevTools panel to the inspected tab. |
| `<all_urls>` | Allow debugging any app the developer opens in DevTools. |

## Disk Storage

| Path | Contents |
| --- | --- |
| `apps/ai-engine/.env` | Local secrets such as API keys. Gitignored. |
| `apps/ai-engine/data/engine.db` | Sessions, detector results, and AI analyses. |
| `apps/ai-engine/data/reports/<id>/` | HTML, Markdown, and JSON reports. |

## Failure Behavior

- AI provider unavailable: deterministic heuristic fallback.
- WebSocket disconnected: DevTools panel still shows local captured events.
- CDP heap capture denied: the engine continues with other detectors.
- Schema parse failure: AI result is discarded and heuristic fallback is returned.
