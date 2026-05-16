/**
 * Report generator. Emits HTML, Markdown, and JSON reports for a finished session.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AiAnalysis, AnalysisSession } from '@angular-ai-debugger/shared-types';
import { config } from '../config.js';

export interface ReportInput {
  session: AnalysisSession;
  analyses: AiAnalysis[];
}

export interface ReportOutput {
  htmlPath: string;
  markdownPath: string;
  jsonPath: string;
}

export function writeReport(input: ReportInput): ReportOutput {
  const baseDir = join(config.storage.dataDir, 'reports', input.session.id);
  mkdirSync(baseDir, { recursive: true });
  const htmlPath = join(baseDir, 'report.html');
  const markdownPath = join(baseDir, 'report.md');
  const jsonPath = join(baseDir, 'report.json');
  writeFileSync(htmlPath, renderHtml(input));
  writeFileSync(markdownPath, renderMarkdown(input));
  writeFileSync(jsonPath, JSON.stringify(input, null, 2));
  return { htmlPath, markdownPath, jsonPath };
}

function renderHtml({ session, analyses }: ReportInput): string {
  const byResultId = new Map(analyses.map((a) => [a.resultId, a]));
  const rows = session.results
    .sort((a, b) => sevRank(b.severity) - sevRank(a.severity))
    .map((r) => {
      const ai = byResultId.get(r.id);
      const actions = ai ? ai.recommendedActions.map((x) => `<li>${esc(x)}</li>`).join('') : '';
      return `
        <article class="row sev-${r.severity}">
          <header>
            <span class="badge ${r.severity}">${r.severity}</span>
            <h3>${esc(r.title)}</h3>
            <span class="meta">${r.detectorId} · ${r.occurrences}×</span>
          </header>
          <p>${esc(r.summary)}</p>
          ${r.detail ? `<pre>${esc(r.detail)}</pre>` : ''}
          ${ai ? `
            <section class="ai">
              <h4>${esc(ai.headline)} <small>(${esc(ai.model)})</small></h4>
              <p><strong>Root cause:</strong> ${esc(ai.rootCause)}</p>
              <p>${esc(ai.explanation)}</p>
              <ol>${actions}</ol>
            </section>` : ''}
        </article>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Angular AI Debugger — Session ${esc(session.id)}</title>
<style>
  :root { color-scheme: dark; }
  body { background:#0e1116; color:#e6edf3; font:14px/1.5 ui-sans-serif, system-ui, sans-serif; padding:24px; max-width:960px; margin:auto; }
  header.page { margin-bottom:24px; }
  .row { border:1px solid #1f242c; border-radius:8px; padding:16px; margin-bottom:16px; }
  .row header { display:flex; align-items:center; gap:8px; }
  .row h3 { margin:0; font-size:15px; }
  .meta { margin-left:auto; color:#7d8590; font-size:12px; }
  .badge { padding:2px 8px; border-radius:999px; font-size:11px; text-transform:uppercase; letter-spacing:.04em; }
  .badge.critical { background:#5a1010; color:#ffb4b4; }
  .badge.high     { background:#4a2a0a; color:#ffcc88; }
  .badge.medium   { background:#2a3a14; color:#cce29c; }
  .badge.low      { background:#1d3148; color:#9cc7ff; }
  .badge.info     { background:#232a33; color:#b1bac4; }
  pre { background:#0a0d12; padding:10px; border-radius:6px; overflow:auto; font:12px/1.4 ui-monospace; }
  .ai { margin-top:12px; padding-top:12px; border-top:1px solid #1f242c; }
  .ai small { color:#7d8590; font-weight:400; }
  ol { margin:0 0 0 18px; padding:0; }
</style>
</head><body>
<header class="page">
  <h1>Angular AI Debugger Report</h1>
  <p>Session <code>${esc(session.id)}</code> · ${session.url ? esc(session.url) : ''} · Started ${new Date(session.startedAt).toISOString()}</p>
</header>
${rows}
</body></html>`;
}

function renderMarkdown({ session, analyses }: ReportInput): string {
  const byResultId = new Map(analyses.map((a) => [a.resultId, a]));
  const lines: string[] = [
    `# Angular AI Debugger Report`,
    ``,
    `**Session:** ${session.id}`,
    session.url ? `**URL:** ${session.url}` : '',
    `**Started:** ${new Date(session.startedAt).toISOString()}`,
    session.endedAt ? `**Ended:** ${new Date(session.endedAt).toISOString()}` : '',
    ``,
  ];
  for (const r of [...session.results].sort((a, b) => sevRank(b.severity) - sevRank(a.severity))) {
    const ai = byResultId.get(r.id);
    lines.push(`## [${r.severity.toUpperCase()}] ${r.title}`);
    lines.push(`Detector: \`${r.detectorId}\` · ${r.occurrences} occurrence(s)`);
    lines.push(``);
    lines.push(r.summary);
    if (r.detail) {
      lines.push(``);
      lines.push('```');
      lines.push(r.detail);
      lines.push('```');
    }
    if (ai) {
      lines.push(``);
      lines.push(`### AI analysis — ${ai.headline} (_${ai.model}_)`);
      lines.push(``);
      lines.push(`**Root cause:** ${ai.rootCause}`);
      lines.push(``);
      lines.push(ai.explanation);
      lines.push(``);
      ai.recommendedActions.forEach((a, i) => lines.push(`${i + 1}. ${a}`));
    }
    lines.push(``);
  }
  return lines.filter((l) => l !== '').join('\n') + '\n';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sevRank(s: string): number {
  return { critical: 4, high: 3, medium: 2, low: 1, info: 0 }[s as 'critical' | 'high' | 'medium' | 'low' | 'info'] ?? 0;
}
