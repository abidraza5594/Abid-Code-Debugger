/**
 * Tiny SQLite-backed store for sessions, AnalysisResults, and AI analyses. Used for the report
 * generator and for re-loading session history. We only persist what's useful for offline
 * inspection — raw events stay in memory.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AiAnalysis,
  AnalysisResult,
  AnalysisSession,
} from '@angular-ai-debugger/shared-types';
import { config } from '../config.js';

mkdirSync(config.storage.dataDir, { recursive: true });

const db = new Database(join(config.storage.dataDir, config.storage.sqliteFile));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    url TEXT,
    user_agent TEXT
  );
  CREATE TABLE IF NOT EXISTS results (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    detector_id TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    detail TEXT,
    confidence REAL NOT NULL,
    occurrences INTEGER NOT NULL,
    first_seen_ms REAL NOT NULL,
    last_seen_ms REAL NOT NULL,
    locations_json TEXT NOT NULL,
    tags_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS analyses (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    result_id TEXT NOT NULL REFERENCES results(id),
    task TEXT NOT NULL,
    model TEXT NOT NULL,
    headline TEXT NOT NULL,
    body_json TEXT NOT NULL,
    generated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_results_session ON results(session_id);
  CREATE INDEX IF NOT EXISTS idx_analyses_session ON analyses(session_id);
`);

const upsertSession = db.prepare(`
  INSERT INTO sessions (id, started_at, ended_at, url, user_agent)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    ended_at = excluded.ended_at,
    url = excluded.url,
    user_agent = excluded.user_agent
`);

const upsertResult = db.prepare(`
  INSERT INTO results
    (id, session_id, detector_id, category, severity, title, summary, detail,
     confidence, occurrences, first_seen_ms, last_seen_ms, locations_json, tags_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    severity = excluded.severity,
    summary = excluded.summary,
    detail = excluded.detail,
    confidence = excluded.confidence,
    occurrences = excluded.occurrences,
    last_seen_ms = excluded.last_seen_ms,
    locations_json = excluded.locations_json,
    tags_json = excluded.tags_json
`);

const insertAnalysis = db.prepare(`
  INSERT OR REPLACE INTO analyses
    (id, session_id, result_id, task, model, headline, body_json, generated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

export const store = {
  saveSession(session: AnalysisSession): void {
    upsertSession.run(
      session.id,
      session.startedAt,
      session.endedAt ?? null,
      session.url ?? null,
      session.userAgent ?? null,
    );
    for (const r of session.results) {
      upsertResult.run(
        r.id,
        session.id,
        r.detectorId,
        r.category,
        r.severity,
        r.title,
        r.summary,
        r.detail ?? null,
        r.confidence,
        r.occurrences,
        r.firstSeenMs,
        r.lastSeenMs,
        JSON.stringify(r.locations),
        JSON.stringify(r.tags),
      );
    }
  },
  saveAnalysis(sessionId: string, analysis: AiAnalysis): void {
    insertAnalysis.run(
      analysis.id,
      sessionId,
      analysis.resultId,
      analysis.task,
      analysis.model,
      analysis.headline,
      JSON.stringify(analysis),
      analysis.generatedAt,
    );
  },
  loadSession(sessionId: string): {
    session: AnalysisSession | undefined;
    analyses: AiAnalysis[];
  } {
    const row = db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(sessionId) as
      | { id: string; started_at: number; ended_at: number | null; url: string | null; user_agent: string | null }
      | undefined;
    if (!row) return { session: undefined, analyses: [] };
    const results = db
      .prepare('SELECT * FROM results WHERE session_id = ?')
      .all(sessionId) as Array<{
      id: string;
      detector_id: string;
      category: string;
      severity: string;
      title: string;
      summary: string;
      detail: string | null;
      confidence: number;
      occurrences: number;
      first_seen_ms: number;
      last_seen_ms: number;
      locations_json: string;
      tags_json: string;
    }>;
    const session: AnalysisSession = {
      id: row.id,
      startedAt: row.started_at,
      ...(row.ended_at !== null ? { endedAt: row.ended_at } : {}),
      ...(row.url !== null ? { url: row.url } : {}),
      ...(row.user_agent !== null ? { userAgent: row.user_agent } : {}),
      counts: {},
      results: results.map((r) => ({
        id: r.id,
        detectorId: r.detector_id,
        category: r.category as AnalysisResult['category'],
        severity: r.severity as AnalysisResult['severity'],
        title: r.title,
        summary: r.summary,
        ...(r.detail !== null ? { detail: r.detail } : {}),
        confidence: r.confidence,
        occurrences: r.occurrences,
        firstSeenMs: r.first_seen_ms,
        lastSeenMs: r.last_seen_ms,
        locations: JSON.parse(r.locations_json),
        evidenceEventSeq: [],
        tags: JSON.parse(r.tags_json),
      })),
    };
    for (const r of session.results) {
      session.counts[r.category] = (session.counts[r.category] ?? 0) + 1;
    }
    const analyses = db
      .prepare('SELECT body_json FROM analyses WHERE session_id = ?')
      .all(sessionId) as Array<{ body_json: string }>;
    return {
      session,
      analyses: analyses.map((a) => JSON.parse(a.body_json) as AiAnalysis),
    };
  },
};
