/**
 * Prompt builders for each Mistral task. We keep the system prompts short and route the
 * supporting facts via the user message — Mistral's structured output works best when the
 * "what to do" instructions live in the system role and the "what to look at" in user role.
 */

import type { AnalysisResult } from '@angular-ai-debugger/shared-types';

export const SYSTEM_ROOT_CAUSE = `You are a Senior Angular performance engineer assisting another engineer through their Chrome DevTools debugger.

Given a detector finding, supporting telemetry (logs, network, change-detection, RxJS, memory, FPS), and optional source context, produce a structured root-cause analysis.

Constraints:
- Be specific. Refer to the actual component / file / RxJS subscription / network endpoint the evidence names.
- Never invent code identifiers that don't appear in the evidence or source context.
- The recommendedActions list must be ordered shortest-path-to-green first.
- Confidence is YOUR self-rated probability that this analysis is correct (0..1).
- estimatedEffort: "trivial" = one-line change, "small" = single component refactor, "medium" = multi-file refactor under an hour, "large" = architecture-level.
`;

export const SYSTEM_FIX = `You are Codestral. Given a root-cause analysis and the affected Angular source, produce a minimal, safe patch.

Rules:
- Output a unified diff (\`--- a/path\\n+++ b/path\` headers). If a fix isn't safely automatable, set autoApplicable=false, leave diff="" and explain in autoApplicableReason.
- Only modify the files necessary for the fix. Do not reformat surrounding code.
- Prefer the modern Angular idiom — \`takeUntilDestroyed\`, \`inject(DestroyRef)\`, signals, \`AsyncPipe\`, control-flow blocks.
- Never widen access modifiers, never delete imports unless strictly unused after the patch.
- The patch must apply with \`git apply -p1\`.
`;

export const SYSTEM_CLASSIFY = `You decide whether a single browser event is actionable noise or worth attention. Be conservative: when in doubt, say isNoise=false.`;

export interface RootCausePromptInput {
  result: AnalysisResult;
  evidenceText: string;
  sourceContext?: Array<{ path: string; content: string }>;
}

export function buildRootCauseUserMessage(input: RootCausePromptInput): string {
  const sources = (input.sourceContext ?? [])
    .map((s) => `// ${s.path}\n${s.content}`)
    .join('\n\n');
  const detail = input.result.detail ?? '';
  const locations = input.result.locations
    .map((l) => [l.file, l.line ? `:${l.line}` : '', l.symbol ? ` ${l.symbol}` : ''].join(''))
    .join('\n');
  return [
    `DETECTOR FINDING`,
    `id: ${input.result.id}`,
    `category: ${input.result.category}`,
    `severity: ${input.result.severity}`,
    `title: ${input.result.title}`,
    `summary: ${input.result.summary}`,
    detail ? `detail:\n${detail}` : '',
    `occurrences: ${input.result.occurrences}`,
    `confidence (detector): ${input.result.confidence}`,
    locations ? `locations:\n${locations}` : '',
    '',
    'EVIDENCE',
    input.evidenceText,
    sources
      ? ['', 'SOURCE CONTEXT', sources].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export interface FixPromptInput {
  analysisHeadline: string;
  rootCause: string;
  recommendedActions: string[];
  affectedLocations: string[];
  source: Array<{ path: string; content: string }>;
}

export function buildFixUserMessage(input: FixPromptInput): string {
  const sources = input.source.map((s) => `// ${s.path}\n${s.content}`).join('\n\n');
  return [
    `HEADLINE: ${input.analysisHeadline}`,
    `ROOT CAUSE: ${input.rootCause}`,
    `RECOMMENDED ACTIONS:`,
    ...input.recommendedActions.map((a, i) => `${i + 1}. ${a}`),
    `AFFECTED LOCATIONS:`,
    ...input.affectedLocations,
    ``,
    `SOURCE`,
    sources,
  ].join('\n');
}

export function buildClassifyUserMessage(event: { source: string; summary: string }): string {
  return `Event source: ${event.source}\nSummary: ${event.summary}\nDecide isNoise.`;
}
