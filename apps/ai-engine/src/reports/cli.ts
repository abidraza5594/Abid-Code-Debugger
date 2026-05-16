/**
 * CLI: `pnpm --filter @angular-ai-debugger/ai-engine report --session <id>`
 *
 * Loads the named session from SQLite and emits HTML/Markdown/JSON reports.
 */

import { store } from '../storage/sqlite.js';
import { writeReport } from './generator.js';

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

const sessionId = arg('session');
if (!sessionId) {
  console.error('Usage: report --session <id>');
  process.exit(1);
}

const data = store.loadSession(sessionId);
if (!data.session) {
  console.error(`Session ${sessionId} not found`);
  process.exit(2);
}
const out = writeReport({ session: data.session, analyses: data.analyses });
console.log('Report written:');
console.log(`  ${out.htmlPath}`);
console.log(`  ${out.markdownPath}`);
console.log(`  ${out.jsonPath}`);
