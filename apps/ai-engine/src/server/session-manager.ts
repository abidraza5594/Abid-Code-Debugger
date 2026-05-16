/**
 * Holds one Pipeline per (tabId, sessionId) tuple. New events arriving over the WebSocket are
 * dispatched to the correct pipeline; analysis / fix requests are dispatched to it too.
 */

import type {
  AnalysisResult,
  CapturedEvent,
} from '@angular-ai-debugger/shared-types';
import { loadBuiltInDetectors } from '../analyzers/detectors/index.js';
import { Pipeline } from '../analyzers/pipeline.js';

type Log = (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;

export class SessionManager {
  private readonly pipelines = new Map<string, Pipeline>();
  private readonly events = new Map<string, CapturedEvent[]>();

  constructor(
    private readonly log: Log,
    private readonly onResult: (sessionId: string, result: AnalysisResult) => void,
  ) {}

  private async getOrCreate(sessionId: string): Promise<Pipeline> {
    let p = this.pipelines.get(sessionId);
    if (!p) {
      p = new Pipeline(sessionId, {
        detectors: loadBuiltInDetectors(),
        now: () => Date.now(),
        log: this.log,
        onResult: (r) => this.onResult(sessionId, r),
      });
      await p.setup();
      this.pipelines.set(sessionId, p);
      this.events.set(sessionId, []);
    }
    return p;
  }

  async ingest(sessionId: string, batch: CapturedEvent[]): Promise<AnalysisResult[]> {
    if (!sessionId) return [];
    const pipeline = await this.getOrCreate(sessionId);
    const buf = this.events.get(sessionId) ?? [];
    buf.push(...batch);
    // Cap stored events to prevent runaway memory.
    if (buf.length > 30_000) buf.splice(0, buf.length - 25_000);
    this.events.set(sessionId, buf);
    return pipeline.ingest(batch);
  }

  getEvents(sessionId: string): CapturedEvent[] {
    return this.events.get(sessionId) ?? [];
  }

  getPipeline(sessionId: string): Pipeline | undefined {
    return this.pipelines.get(sessionId);
  }

  async finalize(sessionId: string): Promise<AnalysisResult[]> {
    const p = this.pipelines.get(sessionId);
    if (!p) return [];
    const out = await p.finalize();
    return out;
  }

  async dispose(sessionId: string): Promise<void> {
    const p = this.pipelines.get(sessionId);
    if (!p) return;
    await p.dispose();
    this.pipelines.delete(sessionId);
    this.events.delete(sessionId);
  }

  allSessions(): string[] {
    return [...this.pipelines.keys()];
  }
}
