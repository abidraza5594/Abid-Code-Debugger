/**
 * A tiny unified-diff generator. We don't need git-quality output for the report — only enough
 * for the panel to render and for users to copy-paste into `git apply`.
 */

export function unifiedDiff(path: string, before: string, after: string): string {
  if (before === after) return '';
  const a = before.split('\n');
  const b = after.split('\n');
  const hunks = computeHunks(a, b);
  if (hunks.length === 0) return '';
  const out: string[] = [`--- a/${path}`, `+++ b/${path}`];
  for (const h of hunks) {
    out.push(`@@ -${h.aStart + 1},${h.aLen} +${h.bStart + 1},${h.bLen} @@`);
    out.push(...h.lines);
  }
  return out.join('\n');
}

interface Hunk {
  aStart: number;
  aLen: number;
  bStart: number;
  bLen: number;
  lines: string[];
}

function computeHunks(a: string[], b: string[]): Hunk[] {
  // Minimal LCS-style alignment is overkill here; we just produce a single hunk that lists
  // every line, marking unchanged/added/removed by a naive longest-prefix / longest-suffix
  // compare. Good enough for small Angular file edits.
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }
  const aMid = a.slice(prefix, a.length - suffix);
  const bMid = b.slice(prefix, b.length - suffix);
  const lines: string[] = [];
  const ctx = 3;
  const contextStart = Math.max(0, prefix - ctx);
  const contextEnd = Math.min(a.length, a.length - suffix + ctx);
  for (let i = contextStart; i < prefix; i++) lines.push(` ${a[i] ?? ''}`);
  for (const removed of aMid) lines.push(`-${removed}`);
  for (const added of bMid) lines.push(`+${added}`);
  for (let i = a.length - suffix; i < contextEnd; i++) lines.push(` ${a[i] ?? ''}`);
  return [
    {
      aStart: contextStart,
      aLen: contextEnd - contextStart - (bMid.length - aMid.length),
      bStart: contextStart,
      bLen: contextEnd - contextStart,
      lines,
    },
  ];
}
