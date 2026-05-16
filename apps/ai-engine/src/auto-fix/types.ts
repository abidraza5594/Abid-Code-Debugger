/**
 * Internal types for the ts-morph auto-fix rules.
 */

import type { Project, SourceFile } from 'ts-morph';

export interface FixRuleContext {
  project: Project;
  source: SourceFile;
  /** Original file path so we can produce a unified diff. */
  filePath: string;
  /** Symbols pointed at by the analysis. */
  symbols: string[];
}

export interface FixRuleResult {
  ruleId: string;
  modified: boolean;
  /** Reason this rule did not modify the file (when modified=false). */
  skippedReason?: string;
  /** Diff against the on-disk file. */
  diff: string;
}

export interface FixRule {
  id: string;
  /** Categories this rule applies to (matches AnalysisResult.category). */
  appliesTo: string[];
  apply(ctx: FixRuleContext): FixRuleResult;
}
