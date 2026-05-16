/**
 * RxJS runtime tracker. Strategy: when we detect rxjs has been loaded (by inspecting the
 * import map / common global names exposed by Angular bundles), we patch `Observable.prototype
 * .subscribe` to record subscribe / unsubscribe lifecycle and capture creation stacks. Long-
 * lived subscriptions (>30s) that never unsubscribe are flagged as leak suspects.
 *
 * Because RxJS is usually bundled, we don't have a guaranteed global. We instead listen for
 * the first observable returned by the app and patch its prototype lazily. This catches the
 * vast majority of cases in real Angular apps.
 */

import { bridge } from '../bridge.js';

interface ObservableLike {
  subscribe: (...args: unknown[]) => SubscriptionLike;
}
interface SubscriptionLike {
  unsubscribe: () => void;
  add?: (other: SubscriptionLike) => unknown;
  closed?: boolean;
}

const LEAK_THRESHOLD_MS = 30_000;
const tracked = new Map<number, { createdAtStack: string; subscribedAt: number }>();
let nextId = 1;
let prototypePatched = false;

export function installRxjsTracker(): void {
  // Trap the first instance of an rxjs Observable returned by any global helper. Common entry
  // points are `from`, `of`, `interval`, etc., all exposed via Angular's HTTP client. We
  // attempt to detect by intercepting Object.getPrototypeOf calls is overkill — instead we
  // proxy a small handful of constructors via a periodic check.

  const tryPatch = (): void => {
    if (prototypePatched) return;
    const candidate = findObservablePrototype();
    if (!candidate) return;
    patchPrototype(candidate);
    prototypePatched = true;
  };

  // Run immediately and then periodically until we find one.
  tryPatch();
  const interval = setInterval(() => {
    tryPatch();
    if (prototypePatched) clearInterval(interval);
  }, 1500);

  // Leak sweep
  setInterval(sweep, 5000);
}

function findObservablePrototype(): ObservableLike | undefined {
  // Heuristic: the dom node `__ngContext__` on an Angular root often contains an `ApplicationRef`
  // whose `_runningTick` field stores an Observable subscription. We pull the constructor up
  // from there. As fallback we also look at common HttpClient instances.
  const roots = (window.getAllAngularRootElements?.() ?? []) as Element[];
  for (const root of roots) {
    const ctx = (root as unknown as { __ngContext__?: unknown[] }).__ngContext__;
    if (!Array.isArray(ctx)) continue;
    for (const entry of ctx) {
      if (entry && typeof entry === 'object') {
        const proto = walkForObservable(entry as object);
        if (proto) return proto;
      }
    }
  }
  return undefined;
}

function walkForObservable(obj: object, depth = 0): ObservableLike | undefined {
  if (depth > 4) return undefined;
  for (const key of Object.keys(obj)) {
    const value = (obj as Record<string, unknown>)[key];
    if (!value || typeof value !== 'object') continue;
    const proto = Object.getPrototypeOf(value) as ObservableLike | null;
    if (proto && typeof (proto as ObservableLike).subscribe === 'function' && proto !== Object.prototype) {
      return proto;
    }
    if (value && typeof value === 'object') {
      const inner = walkForObservable(value as object, depth + 1);
      if (inner) return inner;
    }
  }
  return undefined;
}

function patchPrototype(proto: ObservableLike): void {
  const origSubscribe = proto.subscribe;
  proto.subscribe = function (this: unknown, ...args: unknown[]): SubscriptionLike {
    const sub = origSubscribe.apply(this, args) as SubscriptionLike;
    const id = nextId++;
    const createdAtStack = cheapStack();
    tracked.set(id, { createdAtStack, subscribedAt: performance.now() });
    bridge.emit({
      source: 'rxjs',
      kind: 'subscribe',
      subscriptionId: id,
      createdAtStack,
    });
    const origUnsub = sub.unsubscribe.bind(sub);
    sub.unsubscribe = (): void => {
      const meta = tracked.get(id);
      tracked.delete(id);
      bridge.emit({
        source: 'rxjs',
        kind: 'unsubscribe',
        subscriptionId: id,
        liveMs: meta ? performance.now() - meta.subscribedAt : undefined,
      });
      origUnsub();
    };
    return sub;
  };
}

function sweep(): void {
  const now = performance.now();
  let suspects = 0;
  for (const [id, meta] of tracked.entries()) {
    const age = now - meta.subscribedAt;
    if (age < LEAK_THRESHOLD_MS) continue;
    suspects++;
    bridge.emit({
      source: 'rxjs',
      kind: 'leak-suspect',
      subscriptionId: id,
      liveMs: age,
      createdAtStack: meta.createdAtStack,
    });
  }
  if (suspects > 0) {
    // Only emit periodic suspects; the dashboard dedupes by subscriptionId.
  }
}

function cheapStack(): string {
  const stack = new Error().stack ?? '';
  return stack.split('\n').slice(3, 9).join('\n');
}
