/**
 * The ts-morph driver. Loads a TypeScript source file from disk, applies the matching rules,
 * and returns a unified diff. The file is never written back automatically — the panel calls
 * `apply-fix` explicitly with dryRun=false to opt in.
 */

import { Project, ScriptTarget, ModuleKind } from 'ts-morph';
import { readFileSync } from 'node:fs';
import { takeUntilDestroyedRule } from './rules/take-until-destroyed.js';
import { trackByRule } from './rules/track-by.js';
import { asyncPipeRule } from './rules/async-pipe.js';
import type { FixRule, FixRuleResult } from './types.js';

const RULES: FixRule[] = [takeUntilDestroyedRule, trackByRule, asyncPipeRule];

export interface ApplyFixesInput {
  category: string;
  filePath: string;
  /** Symbols pointed at by the analysis (component names, etc.). */
  symbols: string[];
}

export interface ApplyFixesOutput {
  ruleResults: FixRuleResult[];
  /** True if at least one rule made changes. */
  changed: boolean;
}

export function runFixes(input: ApplyFixesInput): ApplyFixesOutput {
  const matching = RULES.filter((r) => r.appliesTo.includes(input.category));
  if (matching.length === 0) return { ruleResults: [], changed: false };

  const project = new Project({
    compilerOptions: {
      target: ScriptTarget.ES2022,
      module: ModuleKind.ESNext,
      strict: true,
    },
    useInMemoryFileSystem: false,
  });
  let source;
  try {
    const text = readFileSync(input.filePath, 'utf8');
    source = project.createSourceFile(input.filePath, text, { overwrite: true });
  } catch (err) {
    return {
      ruleResults: [
        {
          ruleId: 'load-file',
          modified: false,
          skippedReason: (err as Error).message,
          diff: '',
        },
      ],
      changed: false,
    };
  }

  const ctx = {
    project,
    source,
    filePath: input.filePath,
    symbols: input.symbols,
  };
  const ruleResults = matching.map((r) => r.apply(ctx));
  return { ruleResults, changed: ruleResults.some((r) => r.modified) };
}
