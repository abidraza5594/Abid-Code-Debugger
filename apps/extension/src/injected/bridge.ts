/**
 * The bridge in the MAIN world. Holds the per-page session id and a sequence counter, batches
 * events, and posts them to the ISOLATED content-script.
 *
 * All capture code uses the bridge — never window.postMessage directly — so we have one place
 * to add backpressure, sampling, and redaction.
 */

import type {
  BaseEvent,
  CapturedEvent,
  Envelope,
} from '@angular-ai-debugger/shared-types';

const BRIDGE_TAG = '__angular_ai_debugger__';

export interface BridgeOptions {
  flushIntervalMs: number;
  maxBatchSize: number;
}

class Bridge {
  readonly sessionId: string;
  private seq = 0;
  private queue: CapturedEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private opts: BridgeOptions;
  private controlHandlers = new Set<(envelope: Envelope) => void>();

  constructor(opts: Partial<BridgeOptions> = {}) {
    this.sessionId = `pg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.opts = { flushIntervalMs: 250, maxBatchSize: 200, ...opts };
    window.addEventListener('message', this.handleMessage);
  }

  /** Stamp an event with sessionId/seq/timestamps and queue it. */
  emit<T extends Omit<BaseEvent, 'sessionId' | 'seq' | 'pageTime' | 'wallTime'> & Partial<BaseEvent>>(
    event: T & Pick<CapturedEvent, 'source'>,
  ): void {
    this.seq += 1;
    const stamped = {
      ...event,
      sessionId: this.sessionId,
      seq: this.seq,
      pageTime: performance.now(),
      wallTime: Date.now(),
    } as unknown as CapturedEvent;
    this.queue.push(stamped);
    if (this.queue.length >= this.opts.maxBatchSize) {
      this.flush();
    } else if (this.flushTimer === undefined) {
      this.flushTimer = setTimeout(() => this.flush(), this.opts.flushIntervalMs);
    }
  }

  flush(): void {
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    const envelope: Envelope = {
      id: `b_${this.seq}`,
      channel: 'capture',
      type: 'batch',
      source: 'page',
      sessionId: this.sessionId,
      payload: { events: batch },
    };
    window.postMessage({ tag: BRIDGE_TAG, envelope }, '*');
  }

  onControl(handler: (env: Envelope) => void): void {
    this.controlHandlers.add(handler);
  }

  private handleMessage = (ev: MessageEvent): void => {
    if (ev.source !== window) return;
    const data = ev.data as { tag?: string; envelope?: Envelope } | null;
    if (!data || data.tag !== BRIDGE_TAG || !data.envelope) return;
    if (data.envelope.source === 'page') return; // ignore our own echoes
    if (data.envelope.channel === 'control') {
      this.controlHandlers.forEach((h) => h(data.envelope!));
    }
  };
}

export const bridge = new Bridge();
