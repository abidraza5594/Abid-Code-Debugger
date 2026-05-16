/**
 * Patches window.fetch to capture request/response timing, status, payload sizes, headers, and
 * (optionally) a redacted preview of the body. Captures every fetch including ones initiated
 * before our other patches load — as long as the page-injector ran at document_start.
 */

import { bridge } from '../bridge.js';
import { redactBodyPreview, redactHeaders, shouldRedactUrl } from '../redact.js';

const MAX_BODY_BYTES = 4096;

let installed = false;

export function installFetchInterceptor(): void {
  if (installed) return;
  installed = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? (typeof input !== 'string' && !(input instanceof URL) ? input.method : 'GET')).toUpperCase();
    const requestId = `f_${Math.random().toString(36).slice(2, 10)}`;
    const start = performance.now();

    const reqHeaders = headerInitToRecord(init?.headers ?? (typeof input !== 'string' && !(input instanceof URL) ? input.headers : undefined));
    const redactReq = shouldRedactUrl(url);

    let requestBodySample: string | undefined;
    let requestBodySize: number | undefined;
    if (init?.body && !redactReq) {
      const captured = await snapshotBody(init.body);
      requestBodySize = captured.size;
      const ct = reqHeaders['content-type'] || reqHeaders['Content-Type'];
      requestBodySample = captured.text
        ? redactBodyPreview(captured.text, ct, MAX_BODY_BYTES).preview
        : undefined;
    }

    bridge.emit({
      source: 'fetch',
      kind: 'request',
      requestId,
      method,
      url,
      requestHeaders: redactHeaders(reqHeaders),
      requestBodySize,
      requestBodySample,
      redacted: redactReq,
      initiator: { type: 'script', stack: cheapStack() },
    });

    try {
      const response = await originalFetch(input, init);
      const duration = performance.now() - start;
      const resHeaders = responseHeadersToRecord(response.headers);
      const ct = resHeaders['content-type'];
      let responseBodySample: string | undefined;
      let responseBodySize: number | undefined;
      const cloned = response.clone();
      try {
        const text = await readResponseBody(cloned);
        responseBodySize = text.length;
        if (!redactReq) {
          responseBodySample = redactBodyPreview(text, ct, MAX_BODY_BYTES).preview;
        }
      } catch {
        // body unreadable (opaque, streaming) — skip
      }
      bridge.emit({
        source: 'fetch',
        kind: 'response',
        requestId,
        method,
        url,
        status: response.status,
        statusText: response.statusText,
        durationMs: duration,
        responseHeaders: redactHeaders(resHeaders),
        responseBodySize,
        responseBodySample,
        fromCache: response.type === 'cors' ? undefined : undefined,
        redacted: redactReq,
      });
      return response;
    } catch (err) {
      bridge.emit({
        source: 'fetch',
        kind: 'error',
        requestId,
        method,
        url,
        durationMs: performance.now() - start,
        statusText: (err as Error).message,
        redacted: redactReq,
      });
      throw err;
    }
  };
}

/* ------------------------------------------------------------------ helpers */

function headerInitToRecord(init: HeadersInit | undefined): Record<string, string> {
  if (!init) return {};
  if (init instanceof Headers) {
    const out: Record<string, string> = {};
    init.forEach((v, k) => (out[k] = v));
    return out;
  }
  if (Array.isArray(init)) {
    const out: Record<string, string> = {};
    for (const [k, v] of init) out[k] = v;
    return out;
  }
  return { ...(init as Record<string, string>) };
}

function responseHeadersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => (out[k] = v));
  return out;
}

async function snapshotBody(body: BodyInit): Promise<{ size: number; text?: string }> {
  if (typeof body === 'string') return { size: body.length, text: body };
  if (body instanceof URLSearchParams) {
    const s = body.toString();
    return { size: s.length, text: s };
  }
  if (body instanceof Blob) {
    if (body.size > MAX_BODY_BYTES * 4) return { size: body.size };
    const text = await body.text().catch(() => '');
    return { size: body.size, text };
  }
  if (body instanceof ArrayBuffer) return { size: body.byteLength };
  if (body instanceof FormData) {
    let size = 0;
    body.forEach((v) => {
      size += typeof v === 'string' ? v.length : (v as File).size;
    });
    return { size };
  }
  return { size: 0 };
}

async function readResponseBody(res: Response): Promise<string> {
  // Read up to MAX_BODY_BYTES * 4 to avoid pulling huge payloads into memory.
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BODY_BYTES * 4) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  reader.cancel().catch(() => undefined);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let str = '';
  for (const c of chunks) str += decoder.decode(c, { stream: true });
  str += decoder.decode();
  return str;
}

function cheapStack(): string | undefined {
  // Cheap stack — captured at fetch site so we know who called us. We strip our own frames.
  const stack = new Error().stack;
  if (!stack) return undefined;
  const lines = stack.split('\n').slice(2, 8);
  return lines.join('\n');
}
