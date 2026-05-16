/**
 * Hooks window.onerror and window.onunhandledrejection. Both events bubble up async work that
 * console.error alone wouldn't catch (e.g. errors thrown in setTimeout callbacks).
 */

import { bridge } from '../bridge.js';

let installed = false;

export function installErrorInterceptor(): void {
  if (installed) return;
  installed = true;

  window.addEventListener('error', (ev: ErrorEvent) => {
    const componentHint = guessComponentFromStack(ev.error?.stack);
    bridge.emit({
      source: 'error',
      message: ev.message,
      filename: ev.filename,
      lineno: ev.lineno,
      colno: ev.colno,
      stack: ev.error?.stack ?? undefined,
      componentHint,
    });
  });

  window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    const reason = ev.reason;
    let message = 'Unhandled rejection';
    let stack: string | undefined;
    if (reason instanceof Error) {
      message = `${reason.name}: ${reason.message}`;
      stack = reason.stack;
    } else if (typeof reason === 'string') {
      message = reason;
    } else if (typeof reason === 'object' && reason !== null) {
      try {
        message = JSON.stringify(reason);
      } catch {
        message = '[unserializable rejection]';
      }
    }
    bridge.emit({
      source: 'rejection',
      reason: message,
      stack,
      origin: guessComponentFromStack(stack),
    });
  });
}

/**
 * Heuristic: walks a stack and returns the first frame that looks like an Angular component or
 * service. Real source-map resolution happens in the engine; we only do a quick best-guess here
 * so the panel has something to display before the engine answers.
 */
function guessComponentFromStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  for (const line of stack.split('\n')) {
    const match = /at\s+(?:new\s+)?([A-Z][\w$]*?(?:Component|Service|Directive|Pipe|Guard|Resolver|Interceptor))\b/.exec(
      line,
    );
    if (match) return match[1];
  }
  return undefined;
}
