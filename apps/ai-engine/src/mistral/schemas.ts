/**
 * Zod schemas used as `responseFormat` for `client.chat.parse(...)`. Each schema corresponds to
 * a typed response from one of the Mistral model tasks. The shapes here intentionally mirror
 * AiAnalysis / AiFixSuggestion in @angular-ai-debugger/shared-types so the engine can return the
 * parsed payload directly to the panel.
 *
 * Schema design rules:
 *  - Keep field names short — they appear in every prompt and waste tokens otherwise.
 *  - Mark every field required. Optionality forces the model to think about whether to fill it
 *    and degrades reliability. Use sentinel values ("" / 0) instead.
 *  - Add `.describe(...)` to fields whose meaning is non-obvious. The Mistral parse() endpoint
 *    inlines descriptions into the JSON Schema sent to the model.
 */

import { z } from 'zod';

export const SourceLocationSchema = z
  .object({
    file: z.string().describe('Best-effort file path; "" when unknown.'),
    line: z.number().int().min(0).describe('1-based line number; 0 when unknown.'),
    column: z.number().int().min(0).describe('1-based column; 0 when unknown.'),
    symbol: z.string().describe('Function / component / pipe identifier.'),
  })
  .strict();

export const RootCauseAnalysisSchema = z
  .object({
    headline: z.string().max(140).describe('One-sentence summary.'),
    rootCause: z.string().describe('Plain-English diagnosis.'),
    explanation: z
      .string()
      .describe('Step-by-step reasoning suitable for a junior engineer.'),
    recommendedActions: z
      .array(z.string())
      .min(1)
      .max(8)
      .describe('Concrete, ordered actions to resolve.'),
    affectedLocations: z.array(SourceLocationSchema).max(10),
    estimatedEffort: z.enum(['trivial', 'small', 'medium', 'large']),
    confidence: z.number().min(0).max(1).describe('Model self-confidence.'),
  })
  .strict();
export type RootCauseAnalysis = z.infer<typeof RootCauseAnalysisSchema>;

export const FixSuggestionSchema = z
  .object({
    title: z.string().max(120),
    body: z
      .string()
      .describe(
        'Markdown body with motivation, fix walkthrough, and code snippets in fenced ```ts blocks.',
      ),
    autoApplicable: z
      .boolean()
      .describe('True only when the fix is mechanical and matches a known safe rule.'),
    autoApplicableReason: z.string(),
    /**
     * Optional unified diff. We don't bind a regex constraint — codestral occasionally needs
     * to emit "no patch produced" wording — but the auto-fix validator will check shape.
     */
    diff: z.string().describe('Unified diff against the affected files, or "" if none.'),
    files: z.array(z.string()).describe('Files touched by the diff.'),
  })
  .strict();
export type FixSuggestion = z.infer<typeof FixSuggestionSchema>;

export const ClassifyNoiseSchema = z
  .object({
    isNoise: z.boolean().describe('True if the event is unactionable noise.'),
    reason: z.string().describe('Brief justification.'),
  })
  .strict();
export type ClassifyNoise = z.infer<typeof ClassifyNoiseSchema>;
