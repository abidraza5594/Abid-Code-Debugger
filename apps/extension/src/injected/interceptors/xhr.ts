/**
 * Patches XMLHttpRequest to capture timing, status, headers, sizes. We use a WeakMap so we
 * don't add enumerable fields to XHR instances (some sites enumerate object keys).
 */

import { bridge } from '../bridge.js';
import { redactBodyPreview, redactHeaders, shouldRedactUrl } from '../redact.js';

const MAX_BODY_BYTES = 4096;

interface PendingXhr {
  requestId: string;
  method: string;
  url: string;
  start: number;
  requestHeaders: Record<string, string>;
  redact: boolean;
}

let installed = false;
const pending = new WeakMap<XMLHttpRequest, PendingXhr>();

export function installXhrInterceptor(): void {
  if (installed) return;
  installed = true;

  const proto = XMLHttpRequest.prototype;
  const origOpen = proto.open;
  const origSetHeader = proto.setRequestHeader;
  const origSend = proto.send;

  proto.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ) {
    const m = method.toUpperCase();
    const u = url.toString();
    pending.set(this, {
      requestId: `x_${Math.random().toString(36).slice(2, 10)}`,
      method: m,
      url: u,
      start: 0,
      requestHeaders: {},
      redact: shouldRedactUrl(u),
    });
    return origOpen.call(this, method, url, async ?? true, username ?? null, password ?? null);
  };

  proto.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
    const p = pending.get(this);
    if (p) p.requestHeaders[name] = value;
    return origSetHeader.call(this, name, value);
  };

  proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const state = pending.get(this);
    if (!state) return origSend.call(this, body as XMLHttpRequestBodyInit | null);
    state.start = performance.now();

    let requestBodySample: string | undefined;
    let requestBodySize: number | undefined;
    if (body && !state.redact) {
      const ct = state.requestHeaders['content-type'] || state.requestHeaders['Content-Type'];
      if (typeof body === 'string') {
        requestBodySize = body.length;
        requestBodySample = redactBodyPreview(body, ct, MAX_BODY_BYTES).preview;
      }
    }

    bridge.emit({
      source: 'xhr',
      kind: 'request',
      requestId: state.requestId,
      method: state.method,
      url: state.url,
      requestHeaders: redactHeaders(state.requestHeaders),
      requestBodySize,
      requestBodySample,
      redacted: state.redact,
    });

    const onLoadEnd = (): void => {
      const duration = performance.now() - state.start;
      const responseHeaders = parseAllHeaders(this.getAllResponseHeaders());
      let responseBodySample: string | undefined;
      let responseBodySize: number | undefined;
      try {
        if (this.responseType === '' || this.responseType === 'text') {
          const text = this.responseText;
          responseBodySize = text.length;
          if (!state.redact) {
            responseBodySample = redactBodyPreview(
              text,
              responseHeaders['content-type'],
              MAX_BODY_BYTES,
            ).preview;
          }
        }
      } catch {
        // some responseTypes throw on responseText access
      }
      bridge.emit({
        source: 'xhr',
        kind: 'response',
        requestId: state.requestId,
        method: state.method,
        url: state.url,
        status: this.status,
        statusText: this.statusText,
        durationMs: duration,
        responseHeaders: redactHeaders(responseHeaders),
        responseBodySample,
        responseBodySize,
        redacted: state.redact,
      });
      this.removeEventListener('loadend', onLoadEnd);
    };
    const onErr = (): void => {
      bridge.emit({
        source: 'xhr',
        kind: 'error',
        requestId: state.requestId,
        method: state.method,
        url: state.url,
        durationMs: performance.now() - state.start,
        statusText: this.statusText || 'network error',
        redacted: state.redact,
      });
    };
    this.addEventListener('loadend', onLoadEnd);
    this.addEventListener('error', onErr, { once: true });
    this.addEventListener('abort', onErr, { once: true });
    this.addEventListener('timeout', onErr, { once: true });

    return origSend.call(this, body as XMLHttpRequestBodyInit | null);
  };
}

function parseAllHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  raw
    .trim()
    .split(/[\r\n]+/)
    .forEach((line) => {
      const idx = line.indexOf(': ');
      if (idx === -1) return;
      const k = line.slice(0, idx).toLowerCase();
      const v = line.slice(idx + 2);
      out[k] = v;
    });
  return out;
}
