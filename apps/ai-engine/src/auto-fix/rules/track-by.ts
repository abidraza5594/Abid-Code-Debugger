/**
 * ts-morph rule: ensure every component class has a `trackById` method when its template uses
 * *ngFor over object arrays. We can't statically parse the .html template here, but we expose
 * a stable trackBy method that the engineer can wire up — the change is safe and idempotent.
 */

import { type ClassDeclaration } from 'ts-morph';
import type { FixRule, FixRuleContext, FixRuleResult } from '../types.js';
import { unifiedDiff } from '../diff.js';

const RULE_ID = 'track-by';

export const trackByRule: FixRule = {
  id: RULE_ID,
  appliesTo: ['expensive-template', 'missing-track-by'],
  apply(ctx: FixRuleContext): FixRuleResult {
    const before = ctx.source.getFullText();
    let modified = false;

    const classes = ctx.source.getClasses().filter((cls) =>
      cls.getDecorators().some((d) => d.getName() === 'Component'),
    );
    for (const cls of classes) {
      if (!cls.getMethod('trackById')) {
        addTrackByMethod(cls);
        modified = true;
      }
    }

    if (!modified) {
      return {
        ruleId: RULE_ID,
        modified: false,
        skippedReason: 'no @Component classes lacking trackById',
        diff: '',
      };
    }
    return {
      ruleId: RULE_ID,
      modified: true,
      diff: unifiedDiff(ctx.filePath, before, ctx.source.getFullText()),
    };
  },
};

function addTrackByMethod(cls: ClassDeclaration): void {
  cls.addMethod({
    name: 'trackById',
    parameters: [
      { name: '_index', type: 'number' },
      { name: 'item', type: '{ id?: string | number }' },
    ],
    returnType: 'string | number',
    statements: ['return item?.id ?? _index;'],
  });
}
