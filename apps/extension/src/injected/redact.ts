/**
 * Redaction policy applied to every payload before it leaves the page. We err on the side of
 * caution: anything that looks like a credential is replaced with "[redacted]".
 */

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-csrf-token',
  'x-xsrf-token',
  'x-api-key',
  'x-auth-token',
]);

const SENSITIVE_KEY_RE = /(password|passwd|secret|token|api[_-]?key|authorization|auth|session)/i;

const SENSITIVE_URL_PATTERNS: RegExp[] = [
  /\/oauth\b/i,
  /\/login\b/i,
  /\/auth\b/i,
  /\/token\b/i,
];

export function shouldRedactUrl(url: string): boolean {
  return SENSITIVE_URL_PATTERNS.some((re) => re.test(url));
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADER_NAMES.has(k.toLowerCase()) ? '[redacted]' : v;
  }
  return out;
}

/**
 * Walks a JSON-shaped value and replaces any value whose key matches the sensitive pattern.
 * The walker stops at depth 6 to bound work.
 */
export function redactJsonShape(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactJsonShape(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY_RE.test(k) ? '[redacted]' : redactJsonShape(v, depth + 1);
  }
  return out;
}

export function redactBodyPreview(body: string, contentType: string | undefined, maxBytes: number): {
  preview: string;
  redacted: boolean;
} {
  if (!body) return { preview: '', redacted: false };
  if ((contentType ?? '').includes('application/json')) {
    try {
      const parsed = JSON.parse(body);
      const cleaned = redactJsonShape(parsed);
      const out = JSON.stringify(cleaned);
      return { preview: out.length > maxBytes ? `${out.slice(0, maxBytes)}…` : out, redacted: true };
    } catch {
      // fall through to plain truncation
    }
  }
  const truncated = body.length > maxBytes ? `${body.slice(0, maxBytes)}…` : body;
  return { preview: truncated, redacted: false };
}
