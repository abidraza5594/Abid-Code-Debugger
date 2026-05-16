/**
 * WebSocket server. The Chrome extension's background service worker connects here. Every
 * frame is one Envelope. We:
 *   • ingest capture batches into the SessionManager,
 *   • handle control commands (start/stop, request-analysis, request-fix, apply-fix),
 *   • broadcast analysis / fix results back to all connections for that tab.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type {
  AnyMessage,
  Envelope,
  ControlCommand,
  AnalysisResult,
} from '@angular-ai-debugger/shared-types';
import { isEnvelope } from '@angular-ai-debugger/shared-types';
import { config } from '../config.js';
import { SessionManager } from './session-manager.js';
import { RootCauseAnalyzer } from '../analyzers/root-cause.js';
import { store } from '../storage/sqlite.js';
import { FixOrchestrator } from '../auto-fix/orchestrator.js';

type Log = (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;

export class EngineWebSocketServer {
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<WebSocket>();
  private readonly sessionTabs = new Map<string, number>();
  private readonly sessionManager: SessionManager;
  private readonly rootCause: RootCauseAnalyzer;
  private readonly fixer: FixOrchestrator;

  constructor(private readonly log: Log) {
    this.wss = new WebSocketServer({ port: config.ws.port });
    this.sessionManager = new SessionManager(log, (sessionId, result) =>
      this.broadcastResult(sessionId, result),
    );
    this.rootCause = new RootCauseAnalyzer({ log });
    this.fixer = new FixOrchestrator({ log });
    this.wss.on('connection', (socket) => this.onConnection(socket));
    this.wss.on('listening', () => log('info', `WebSocket listening on :${config.ws.port}`));
  }

  private onConnection(socket: WebSocket): void {
    this.clients.add(socket);
    socket.on('message', (data) => {
      let msg: unknown;
      try {
        msg = JSON.parse(data.toString('utf8'));
      } catch {
        return;
      }
      if (!isEnvelope(msg)) return;
      void this.dispatch(msg as AnyMessage);
    });
    socket.on('close', () => this.clients.delete(socket));
    socket.on('error', () => socket.close());
  }

  private async dispatch(msg: AnyMessage): Promise<void> {
    if (msg.channel === 'session' && msg.type === 'started') {
      if (!msg.sessionId) return;
      if (msg.tabId !== undefined) this.sessionTabs.set(msg.sessionId, msg.tabId);
      await this.sessionManager.setSessionMeta(msg.sessionId, {
        url: msg.payload.url,
        userAgent: msg.payload.userAgent,
      });
      return;
    }
    if (msg.channel === 'capture') {
      const batch = msg.type === 'batch' ? msg.payload.events : [msg.payload.event];
      if (!msg.sessionId) return;
      if (msg.tabId !== undefined) this.sessionTabs.set(msg.sessionId, msg.tabId);
      await this.sessionManager.ingest(msg.sessionId, batch);
      return;
    }
    if (msg.channel === 'control' && msg.type === 'command') {
      await this.handleControl(msg.payload as ControlCommand, msg);
      return;
    }
  }

  private async handleControl(cmd: ControlCommand, envelope: AnyMessage): Promise<void> {
    if (!envelope.sessionId) return;
    if (cmd.name === 'request-analysis') {
      await this.runAnalysis(envelope.sessionId, envelope.tabId);
      return;
    }
    if (cmd.name === 'request-fix') {
      await this.runFixSuggestion(envelope.sessionId, cmd.analysisId, envelope.tabId);
      return;
    }
    // start-capture / stop-capture / clear-buffer / etc — currently no-op in the engine,
    // because runtime state lives on the page.
  }

  private async runAnalysis(sessionId: string, tabId?: number): Promise<void> {
    const pipeline = this.sessionManager.getPipeline(sessionId);
    if (!pipeline) return;
    const session = pipeline.snapshotSession();
    store.saveSession(session);
    const events = this.sessionManager.getEvents(sessionId);
    // Prioritize highest-severity results first so the user sees them sooner.
    const sorted = [...session.results].sort(
      (a, b) => severityRank(b.severity) - severityRank(a.severity) || b.occurrences - a.occurrences,
    );
    for (const result of sorted) {
      const analysis = await this.rootCause.analyze(result, events);
      store.saveAnalysis(sessionId, analysis);
      this.broadcast({
        id: analysis.id,
        channel: 'analysis',
        type: 'results',
        source: 'engine',
        sessionId,
        ...(tabId !== undefined ? { tabId } : {}),
        payload: { results: [result], analyses: [analysis] },
      } satisfies Envelope);
      this.broadcast({
        id: `ai:${analysis.id}`,
        channel: 'analysis',
        type: 'session-update',
        source: 'engine',
        sessionId,
        ...(tabId !== undefined ? { tabId } : {}),
        payload: {
          session: { ...session, results: [result] },
          analyses: [analysis],
        },
      } satisfies Envelope);
    }
  }

  private async runFixSuggestion(
    sessionId: string,
    analysisId: string,
    tabId: number | undefined,
  ): Promise<void> {
    const suggestion = await this.fixer.suggestFor(sessionId, analysisId);
    if (!suggestion) return;
    this.broadcast({
      id: suggestion.id,
      channel: 'fix',
      type: 'suggestion',
      source: 'engine',
      sessionId,
      ...(tabId !== undefined ? { tabId } : {}),
      payload: { suggestion },
    } satisfies Envelope);
  }

  private broadcastResult(sessionId: string, result: AnalysisResult): void {
    const tabId = this.sessionTabs.get(sessionId);
    this.broadcast({
      id: `live:${result.id}`,
      channel: 'analysis',
      type: 'results',
      source: 'engine',
      sessionId,
      ...(tabId !== undefined ? { tabId } : {}),
      payload: { results: [result] },
    } satisfies Envelope);
  }

  private broadcast(env: Envelope): void {
    const data = JSON.stringify(env);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }
}

function severityRank(s: string): number {
  return { critical: 4, high: 3, medium: 2, low: 1, info: 0 }[s as 'critical' | 'high' | 'medium' | 'low' | 'info'] ?? 0;
}
