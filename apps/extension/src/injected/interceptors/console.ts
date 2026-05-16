/**
 * Patches console methods to forward log/info/warn/error/debug entries to the bridge while
 * preserving the original behavior. Args are serialized via a depth-bounded preview so we never
 * stringify huge objects synchronously on the hot path.
 */

import { bridge } from '../bridge.js';

const PREVIEW_DEPTH = 3;
const PREVIEW_MAX_ENTRIES = 25;
const PREVIEW_MAX_STR = 512;

let installed = false;

export function installConsoleInterceptor(): void {
  if (installed) return;
  installed = true;
  (['log', 'info', 'warn', 'error', 'debug'] as const).forEach((level) => {
    const original = console[level].bind(console) as (...args: unknown[]) => void;
    console[level] = (...args: unknown[]): void => {
      try {
        bridge.emit({
          source: 'console',
          level,
          args: args.map(previewArg),
          stack: level === 'error' || level === 'warn' ? captureStack() : undefined,
        });
      } catch {
        // never throw from console hook
      }
      original(...args);
    };
  });
}

function previewArg(value: unknown, depth = 0): string {
  if (depth > PREVIEW_DEPTH) return '[…]';
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const t = typeof value;
  if (t === 'string') return clipString(value as string);
  if (t === 'number' || t === 'boolean' || t === 'bigint') return String(value);
  if (t === 'function') return `[Function ${(value as Function).name || 'anonymous'}]`;
  if (t === 'symbol') return (value as symbol).toString();
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (value instanceof HTMLElement) return `<${value.tagName.toLowerCase()}${value.id ? `#${value.id}` : ''}>`;
  if (Array.isArray(value)) {
    const items = value.slice(0, PREVIEW_MAX_ENTRIES).map((v) => previewArg(v, depth + 1));
    return `[${items.join(', ')}${value.length > PREVIEW_MAX_ENTRIES ? ', …' : ''}]`;
  }
  if (t === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, PREVIEW_MAX_ENTRIES);
    const inner = entries.map(([k, v]) => `${k}: ${previewArg(v, depth + 1)}`).join(', ');
    return `{${inner}${Object.keys(value as object).length > PREVIEW_MAX_ENTRIES ? ', …' : ''}}`;
  }
  return String(value);
}

function clipString(s: string): string {
  return s.length > PREVIEW_MAX_STR ? `${s.slice(0, PREVIEW_MAX_STR)}…` : s;
}

function captureStack(): string | undefined {
  const stack = new Error().stack;
  if (!stack) return undefined;
  return stack.split('\n').slice(3, 12).join('\n');
}
