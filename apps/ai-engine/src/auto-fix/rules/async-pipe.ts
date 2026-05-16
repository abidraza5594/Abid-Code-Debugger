/**
 * ts-morph rule: convert obvious `this.foo$.subscribe(v => this.foo = v)` patterns into a
 * direct exposure of the Observable so the template can use AsyncPipe. We only rewrite the
 * trivial shape: one .subscribe call, one assignment, no other side effects, no operators.
 */

import { Node, SyntaxKind, type CallExpression } from 'ts-morph';
import type { FixRule, FixRuleContext, FixRuleResult } from '../types.js';
import { unifiedDiff } from '../diff.js';

const RULE_ID = 'async-pipe';

export const asyncPipeRule: FixRule = {
  id: RULE_ID,
  appliesTo: ['rxjs-leak', 'expensive-template'],
  apply(ctx: FixRuleContext): FixRuleResult {
    const before = ctx.source.getFullText();
    let modified = false;

    for (const cls of ctx.source.getClasses()) {
      for (const method of [...cls.getMethods(), ...cls.getConstructors()]) {
        const stmts = method.getDescendantsOfKind(SyntaxKind.ExpressionStatement);
        for (const stmt of stmts) {
          const call = stmt.getFirstChildIfKind(SyntaxKind.CallExpression);
          if (!call) continue;
          if (!isTrivialSubscribeAssignment(call)) continue;
          // Delete the .subscribe statement so the engineer can replace it with `value$ | async`
          // in the template. We DON'T rename the field — that would need template knowledge.
          stmt.remove();
          modified = true;
        }
      }
    }

    if (!modified) {
      return { ruleId: RULE_ID, modified: false, skippedReason: 'no trivial subscribe-assign patterns', diff: '' };
    }
    return {
      ruleId: RULE_ID,
      modified: true,
      diff: unifiedDiff(ctx.filePath, before, ctx.source.getFullText()),
    };
  },
};

function isTrivialSubscribeAssignment(call: CallExpression): boolean {
  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr) || expr.getName() !== 'subscribe') return false;
  const args = call.getArguments();
  if (args.length !== 1) return false;
  const fn = args[0]!;
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false;
  const body = fn.getBody();
  // body must be a single expression `this.X = v`
  if (Node.isBinaryExpression(body)) {
    if (body.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) return false;
    const left = body.getLeft();
    if (!Node.isPropertyAccessExpression(left)) return false;
    return left.getExpression().getKind() === SyntaxKind.ThisKeyword;
  }
  if (Node.isBlock(body)) {
    const statements = body.getStatements();
    if (statements.length !== 1) return false;
    const inner = statements[0];
    if (!inner || !Node.isExpressionStatement(inner)) return false;
    const exprStmt = inner.getExpression();
    if (!Node.isBinaryExpression(exprStmt)) return false;
    if (exprStmt.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) return false;
    const left = exprStmt.getLeft();
    if (!Node.isPropertyAccessExpression(left)) return false;
    return left.getExpression().getKind() === SyntaxKind.ThisKeyword;
  }
  return false;
}
