/**
 * The detector pipeline. Each session owns one Pipeline. Events arrive in batches via
 * `ingest(events)`; the pipeline routes them to every registered detector, accumulates
 * AnalysisResults, and emits incremental updates over the WebSocket bus.
 *
 * The pipeline is deliberately synchronous — detectors must finish in milliseconds. AI
 * synthesis is async and lives in a separate stage triggered by `synthesize()`.
 */

import type {
  AnalysisResult,
  AnalysisSession,
  CapturedEvent,
  Detector,
  DetectorContext,
  IssueCategory,
} from '@angular-ai-debugger/shared-types';

export interface PipelineDeps {
  detectors: Detector[];
  onResult: (result: AnalysisResult) => void;
  now: () => number;
  log: DetectorContext['log'];
}

export class Pipeline {
  readonly sessionId: string;
  private readonly state = new Map<string, Map<string, unknown>>(); // detectorId -> kv
  private readonly results = new Map<string, AnalysisResult>();
  private readonly counts: Partial<Record<IssueCategory, number>> = {};
  private startedAt: number;
  private endedAt: number | undefined;
  private url: string | undefined;
  private userAgent: string | undefined;

  constructor(sessionId: string, private readonly deps: PipelineDeps) {
    this.sessionId = sessionId;
    this.startedAt = deps.now();
  }

  async setup(): Promise<void> {
    for (const d of this.deps.detectors) {
      const ctx = this.contextFor(d);
      await d.setup(ctx);
    }
  }

  setSessionMeta(meta: { url?: string; userAgent?: string }): void {
    if (meta.url !== undefined) this.url = meta.url;
    if (meta.userAgent !== undefined) this.userAgent = meta.userAgent;
  }

  async ingest(events: CapturedEvent[]): Promise<AnalysisResult[]> {
    if (events.length === 0) return [];
    const all: AnalysisResult[] = [];
    for (const d of this.deps.detectors) {
      const filtered = d.consumes.length === 0
        ? events
        : events.filter((e) => d.consumes.includes(e.source));
      if (filtered.length === 0) continue;
      const ctx = this.contextFor(d);
      try {
        const out = await d.analyze(filtered, ctx);
        for (const r of out) this.upsert(r);
        all.push(...out);
      } catch (err) {
        this.deps.log('error', `detector ${d.id} threw`, err);
      }
    }
    return all;
  }

  async finalize(): Promise<AnalysisResult[]> {
    this.endedAt = this.deps.now();
    const all: AnalysisResult[] = [];
    for (const d of this.deps.detectors) {
      const ctx = this.contextFor(d);
      try {
        const out = await d.finalize(ctx);
        for (const r of out) this.upsert(r);
        all.push(...out);
      } catch (err) {
        this.deps.log('error', `detector ${d.id} finalize threw`, err);
      }
    }
    return all;
  }

  async dispose(): Promise<void> {
    for (const d of this.deps.detectors) {
      const ctx = this.contextFor(d);
      try {
        await d.cleanup(ctx);
      } catch (err) {
        this.deps.log('error', `detector ${d.id} cleanup threw`, err);
      }
    }
  }

  snapshotSession(): AnalysisSession {
    return {
      id: this.sessionId,
      startedAt: this.startedAt,
      ...(this.endedAt !== undefined ? { endedAt: this.endedAt } : {}),
      ...(this.url !== undefined ? { url: this.url } : {}),
      ...(this.userAgent !== undefined ? { userAgent: this.userAgent } : {}),
      counts: { ...this.counts },
      results: Array.from(this.results.values()),
    };
  }

  getResult(id: string): AnalysisResult | undefined {
    return this.results.get(id);
  }

  /* ----- private ----- */

  private contextFor(d: Detector): DetectorContext {
    let stateMap = this.state.get(d.id);
    if (!stateMap) {
      stateMap = new Map<string, unknown>();
      this.state.set(d.id, stateMap);
    }
    return {
      sessionId: this.sessionId,
      now: this.deps.now,
      emit: (r) => this.upsert(r),
      state: stateMap,
      log: this.deps.log,
    };
  }

  private upsert(result: AnalysisResult): void {
    const existing = this.results.get(result.id);
    if (existing) {
      existing.occurrences = result.occurrences;
      existing.lastSeenMs = result.lastSeenMs;
      existing.severity = result.severity;
      existing.summary = result.summary;
      if (result.detail) existing.detail = result.detail;
      existing.confidence = result.confidence;
      existing.evidenceEventSeq = result.evidenceEventSeq;
    } else {
      this.results.set(result.id, result);
      this.counts[result.category] = (this.counts[result.category] ?? 0) + 1;
    }
    this.deps.onResult(this.results.get(result.id)!);
  }
}
