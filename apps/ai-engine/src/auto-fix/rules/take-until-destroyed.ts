/**
 * ts-morph rule: replace `.subscribe(...)` calls inside Angular components with
 * `.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(...)`.
 *
 * Heuristic match (because we don't run the Angular language service):
 *   - File is a `.ts`, class is decorated with @Component or @Directive.
 *   - The .subscribe() call is on an expression whose root is `this.<member>` or a const.
 *   - We only rewrite calls inside ngOnInit (or the constructor) — the safe shape.
 */

import { Node, SyntaxKind, type CallExpression } from 'ts-morph';
import type { FixRule, FixRuleContext, FixRuleResult } from '../types.js';
import { unifiedDiff } from '../diff.js';

const RULE_ID = 'take-until-destroyed';

export const takeUntilDestroyedRule: FixRule = {
  id: RULE_ID,
  appliesTo: ['rxjs-leak'],
  apply(ctx: FixRuleContext): FixRuleResult {
    const before = ctx.source.getFullText();
    let modified = false;

    const componentClasses = ctx.source.getClasses().filter((cls) =>
      cls.getDecorators().some((d) => {
        const name = d.getName();
        return name === 'Component' || name === 'Directive';
      }),
    );
    if (componentClasses.length === 0) {
      return { ruleId: RULE_ID, modified: false, skippedReason: 'no @Component class', diff: '' };
    }

    ensureImport(ctx, '@angular/core/rxjs-interop', 'takeUntilDestroyed');
    ensureImport(ctx, '@angular/core', 'inject');
    ensureImport(ctx, '@angular/core', 'DestroyRef');

    for (const cls of componentClasses) {
      const destroyRefField = ensureDestroyRefField(cls);

      for (const method of [...cls.getMethods(), ...cls.getConstructors()]) {
        const name = method.getKind() === SyntaxKind.Constructor ? 'constructor' : (method as { getName(): string }).getName();
        if (name !== 'constructor' && name !== 'ngOnInit') continue;

        method.forEachDescendant((node) => {
          if (!Node.isCallExpression(node)) return;
          if (!isSubscribeCall(node)) return;
          if (alreadyHasTakeUntilDestroyed(node)) return;

          const receiverText = receiverExpression(node);
          if (!receiverText) return;
          node.getExpression().replaceWithText(
            `${receiverText}.pipe(takeUntilDestroyed(this.${destroyRefField})).subscribe`,
          );
          modified = true;
        });
      }
    }

    if (!modified) {
      return { ruleId: RULE_ID, modified: false, skippedReason: 'no matching .subscribe() calls', diff: '' };
    }

    const after = ctx.source.getFullText();
    return {
      ruleId: RULE_ID,
      modified: true,
      diff: unifiedDiff(ctx.filePath, before, after),
    };
  },
};

function isSubscribeCall(node: CallExpression): boolean {
  const expr = node.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return false;
  return expr.getName() === 'subscribe';
}

function alreadyHasTakeUntilDestroyed(node: CallExpression): boolean {
  const expr = node.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return false;
  // walk left through `.pipe(...)` chain
  let cur: Node = expr.getExpression();
  while (Node.isCallExpression(cur)) {
    const callee = cur.getExpression();
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'pipe') {
      for (const arg of cur.getArguments()) {
        if (Node.isCallExpression(arg)) {
          const argExpr = arg.getExpression();
          if (Node.isIdentifier(argExpr) && argExpr.getText() === 'takeUntilDestroyed') return true;
        }
      }
    }
    cur = (callee as unknown as { getExpression(): Node }).getExpression();
  }
  return false;
}

function receiverExpression(node: CallExpression): string | undefined {
  const expr = node.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return undefined;
  return expr.getExpression().getText();
}

function ensureImport(ctx: FixRuleContext, moduleSpecifier: string, named: string): void {
  let imp = ctx.source.getImportDeclaration((d) => d.getModuleSpecifierValue() === moduleSpecifier);
  if (!imp) {
    imp = ctx.source.addImportDeclaration({ moduleSpecifier, namedImports: [named] });
    return;
  }
  if (!imp.getNamedImports().some((n) => n.getName() === named)) {
    imp.addNamedImport(named);
  }
}

function ensureDestroyRefField(cls: ReturnType<FixRuleContext['source']['getClasses']>[number]): string {
  const fieldName = 'destroyRef';
  const existing = cls.getProperty(fieldName);
  if (!existing) {
    cls.insertProperty(0, {
      name: fieldName,
      initializer: 'inject(DestroyRef)',
      isReadonly: true,
      scope: 'private' as never,
    });
  }
  return fieldName;
}
