// Pending change operations drawn over the extracted deck. A requested item is
// part of the picture, and it never looks implemented (spec §3.8).
import type { Bullet, ChangeOp, DeckEdge, DeckNode, DeckSnapshot, Id, Link } from '@decker/deck-model';

export type MarkState = 'requested' | 'changed' | 'renamed' | 'removed';

export interface Mark {
  state: MarkState;
  opId: Id;
  before?: string;
}

export type Marks = Map<Id, Mark>;

const authored = (id: Id, text: string): Bullet => ({ id, text, origin: 'authored' });

export function applyOps(
  snapshot: DeckSnapshot,
  ops: readonly ChangeOp[],
): { snapshot: DeckSnapshot; marks: Marks } {
  const marks: Marks = new Map();
  if (ops.length === 0) return { snapshot, marks };

  const nodePatch = new Map<Id, DeckNode>();
  const edgePatch = new Map<Id, DeckEdge>();
  const newNodes: DeckNode[] = [];
  const newEdges: DeckEdge[] = [];
  const nodeById = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const edgeById = new Map(snapshot.edges.map((e) => [e.id, e]));
  const node = (id: Id) => nodePatch.get(id) ?? nodeById.get(id) ?? newNodes.find((n) => n.id === id);

  for (const op of ops) {
    switch (op.type) {
      case 'add_block':
        newNodes.push({
          id: op.id,
          kind: 'block',
          name: op.name,
          parentId: op.parentId,
          bullets: op.bullets.map((t, i) => authored(`${op.id}:b${i}`, t)),
          source: [],
          coverage: 'full',
        });
        marks.set(op.id, { state: 'requested', opId: op.id });
        break;
      case 'add_edge':
        newEdges.push({
          id: op.id,
          from: op.from,
          to: op.to,
          kind: op.kind,
          label: op.label || undefined,
          bullets: op.bullets.map((t, i) => authored(`${op.id}:b${i}`, t)),
          evidence: [],
        });
        marks.set(op.id, { state: 'requested', opId: op.id });
        break;
      case 'add_behavior': {
        const n = node(op.targetId);
        if (n) {
          const next = { ...n, bullets: [...n.bullets, authored(op.id, op.text)] };
          if (nodeById.has(n.id)) nodePatch.set(n.id, next);
          else newNodes[newNodes.findIndex((x) => x.id === n.id)] = next;
        } else {
          const e = edgePatch.get(op.targetId) ?? edgeById.get(op.targetId);
          if (e) edgePatch.set(e.id, { ...e, bullets: [...e.bullets, authored(op.id, op.text)] });
          else {
            const i = newEdges.findIndex((x) => x.id === op.targetId);
            if (i >= 0)
              newEdges[i] = { ...newEdges[i]!, bullets: [...newEdges[i]!.bullets, authored(op.id, op.text)] };
          }
        }
        marks.set(op.id, { state: 'requested', opId: op.id });
        break;
      }
      case 'set_behavior': {
        const n = node(op.targetId);
        if (n) {
          const swap = (b: Bullet) => (b.id === op.bulletId ? { ...b, text: op.text } : b);
          nodePatch.set(n.id, {
            ...n,
            bullets: n.bullets.map(swap),
            summary: n.summary ? swap(n.summary) : undefined,
          });
        }
        marks.set(op.bulletId, { state: 'changed', opId: op.id, before: op.before });
        break;
      }
      case 'rename': {
        const n = node(op.targetId);
        if (n) nodePatch.set(n.id, { ...n, name: op.name });
        marks.set(op.targetId, { state: 'renamed', opId: op.id, before: op.before });
        break;
      }
      case 'remove':
        marks.set(op.targetId, { state: 'removed', opId: op.id });
        break;
    }
  }

  return {
    snapshot: {
      ...snapshot,
      nodes: [...snapshot.nodes.map((n) => nodePatch.get(n.id) ?? n), ...newNodes],
      edges: [...snapshot.edges.map((e) => edgePatch.get(e.id) ?? e), ...newEdges],
    },
    marks,
  };
}

/** The pending state of an arrow, rolled up from its edges. */
export function linkMark(link: Link, marks: Marks): Mark | undefined {
  const own = marks.get(link.id);
  if (own) return own;
  if (marks.size === 0) return undefined;
  let requested = 0;
  let first: Mark | undefined;
  for (const e of link.edges) {
    const m = marks.get(e.id);
    if (m?.state === 'requested') {
      requested += 1;
      first ??= m;
    }
  }
  return requested === link.edges.length ? first : undefined;
}

/** Requested edges inside an arrow that also has implemented ones. */
export function pendingInLink(link: Link, marks: Marks): number {
  if (marks.size === 0) return 0;
  let n = 0;
  for (const e of link.edges) if (marks.get(e.id)?.state === 'requested') n += 1;
  return n === link.edges.length ? 0 : n;
}
