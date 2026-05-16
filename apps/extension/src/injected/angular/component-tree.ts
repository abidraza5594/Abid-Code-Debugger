/**
 * Builds a snapshot of the Angular component tree starting at every Angular root.
 *
 * Returns a serializable tree that the engine can pass to Mistral as context. We deliberately
 * keep the structure shallow (name + tag + child count) so the JSON stays cheap to ship.
 */

export interface ComponentNode {
  name: string;
  selector: string;
  tag: string;
  /** Stable id derived from a private property attached to the host element. */
  id: string;
  children: ComponentNode[];
}

export function snapshotComponentTree(maxDepth = 50, maxNodes = 5000): ComponentNode[] {
  const ng = window.ng;
  const roots = window.getAllAngularRootElements?.() ?? [];
  if (!ng?.getComponent || roots.length === 0) return [];
  const out: ComponentNode[] = [];
  let counter = 0;
  for (const root of roots) {
    const tree = walk(root, ng, 0, maxDepth, () => ++counter, maxNodes);
    if (tree) out.push(tree);
  }
  return out;
}

function walk(
  el: Element,
  ng: NonNullable<Window['ng']>,
  depth: number,
  maxDepth: number,
  counter: () => number,
  maxNodes: number,
): ComponentNode | undefined {
  if (depth > maxDepth || counter() > maxNodes) return undefined;
  const cmp = ng.getComponent?.(el);
  const tag = el.tagName.toLowerCase();
  const children: ComponentNode[] = [];
  for (const child of Array.from(el.children)) {
    const node = walk(child, ng, depth + 1, maxDepth, counter, maxNodes);
    if (node) children.push(node);
  }
  if (!cmp && children.length === 0) return undefined;
  const ctor = (cmp as { constructor?: { name?: string } } | undefined)?.constructor;
  return {
    name: ctor?.name ?? '(host)',
    selector: tag,
    tag,
    id: stableId(el),
    children,
  };
}

function stableId(el: Element): string {
  const key = '__ng_tree_id__';
  const cur = (el as unknown as Record<string, string>)[key];
  if (cur) return cur;
  const id = `n_${Math.random().toString(36).slice(2, 10)}`;
  Object.defineProperty(el, key, { value: id, enumerable: false });
  return id;
}
