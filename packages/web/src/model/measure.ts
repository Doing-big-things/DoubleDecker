// Deterministic sizes. Every line on a card has a fixed height, so the layout never
// has to measure the DOM, and a block's size is a pure function of its content and state.
import {
  type CardBullet,
  cardBullets,
  childrenOfKind,
  type DeckIndex,
  type DeckNode,
  type DeckTest,
  type Id,
  isInternal,
  operationsOf,
  type TestRun,
} from '@decker/deck-model';

export const BLOCK_W = 280;
export const MAX_BULLETS = 5;
export const MAX_DRAWER_TESTS = 8;

const FRAME = 26; // 12 px padding and 1 px border, top and bottom
const TITLE = 20;
const SUMMARY = 20;
const GAP = 6;
const ROW = 18;
const SECTION = 24;
const OP = 38;
const OP_INTERNAL = 20;
const FOOT = 27;
const DRAWER = 13; // divider and padding, less the card padding the drawer replaces

export interface SizeState {
  expanded: ReadonlySet<Id>;
  internals: ReadonlySet<Id>;
  testsOpen: (id: Id) => boolean;
  run: TestRun | null;
}

export function collapsedHeight(index: DeckIndex, id: Id): number {
  const block = index.byId.get(id);
  const n = cardBullets(index, id).length;
  return (
    FRAME +
    TITLE +
    (block?.summary ? SUMMARY : 0) +
    (n ? GAP + Math.min(n, MAX_BULLETS) * ROW + (n > MAX_BULLETS ? ROW : 0) : 0)
  );
}

/** How many bullets fit when card text is scaled up to stay legible (text scale > 1). */
export function fitBullets(
  index: DeckIndex,
  id: Id,
  ts: number,
  bullets: CardBullet[],
): { summary: boolean; shown: number; more: number } {
  const block = index.byId.get(id);
  const inner = collapsedHeight(index, id) - FRAME;
  let left = inner - TITLE * ts;
  const summary = Boolean(block?.summary) && left >= SUMMARY * ts - 1;
  if (summary) left -= SUMMARY * ts;
  left -= GAP * ts;
  const rows = Math.max(0, Math.floor((left + 1) / (ROW * ts)));
  const cap = Math.min(bullets.length, MAX_BULLETS);
  if (ts <= 1.001) return { summary: true, shown: cap, more: bullets.length - cap };
  if (rows >= bullets.length) return { summary, shown: bullets.length, more: 0 };
  const shown = Math.max(0, Math.min(cap, rows - 1));
  return { summary, shown, more: bullets.length - shown };
}

export type DrawerRow =
  | { t: 'group'; id: Id; label: string; tests: DeckTest[] }
  | { t: 'test'; test: DeckTest }
  | { t: 'more'; n: number; what: 'tests' | 'operations' };

/** Tests grouped by the operation they call. Failing tests come first. */
export function testGroups(
  index: DeckIndex,
  blockId: Id,
  run: TestRun | null,
): { id: Id; label: string; tests: DeckTest[] }[] {
  const rank = (t: DeckTest) => {
    const s = run?.results[t.id];
    return s === 'failed' ? 0 : s === 'skipped' ? 2 : 1;
  };
  const groups: { id: Id; label: string; tests: DeckTest[] }[] = [];
  for (const op of operationsOf(index, blockId)) {
    const tests = index.testsOf.get(op.id);
    if (tests?.length)
      groups.push({ id: op.id, label: op.name, tests: [...tests].sort((a, b) => rank(a) - rank(b)) });
  }
  const loose = (index.testsOf.get(blockId) ?? []).filter((t) => t.targets.some((x) => x.id === blockId));
  if (loose.length) groups.push({ id: blockId, label: 'whole block', tests: loose });
  return groups;
}

export function drawerRows(index: DeckIndex, blockId: Id, run: TestRun | null): DrawerRow[] {
  const groups = testGroups(index, blockId, run);
  const shownGroups = groups.slice(0, 8);
  const take = shownGroups.map((g) => Math.min(g.tests.length, 3));
  let total = take.reduce((a, b) => a + b, 0);
  for (let i = take.length - 1; total > MAX_DRAWER_TESTS && i >= 0; i--) {
    const cut = Math.min(take[i]!, total - MAX_DRAWER_TESTS);
    take[i]! -= cut;
    total -= cut;
  }
  for (let i = 0; total < MAX_DRAWER_TESTS && i < take.length; i++) {
    const add = Math.min(shownGroups[i]!.tests.length - take[i]!, MAX_DRAWER_TESTS - total);
    take[i]! += add;
    total += add;
  }
  const rows: DrawerRow[] = [];
  shownGroups.forEach((g, i) => {
    rows.push({ t: 'group', ...g });
    for (const test of g.tests.slice(0, take[i])) rows.push({ t: 'test', test });
    const hidden = g.tests.length - take[i]!;
    if (hidden > 0 && take[i]! > 0) rows.push({ t: 'more', n: hidden, what: 'tests' });
  });
  if (groups.length > shownGroups.length)
    rows.push({ t: 'more', n: groups.length - shownGroups.length, what: 'operations' });
  return rows;
}

export interface ExpandedPlan {
  notes: CardBullet[];
  ops: DeckNode[];
  internalOps: DeckNode[];
  data: DeckNode[];
  hasInternals: boolean;
}

export function expandedPlan(index: DeckIndex, id: Id, showInternals: boolean): ExpandedPlan {
  const block = index.byId.get(id);
  const all = operationsOf(index, id);
  const internal = all.filter(isInternal);
  return {
    notes: (block?.bullets ?? []).map((bullet) => ({ bullet, ownerId: id })),
    ops: all.filter((o) => !isInternal(o)),
    internalOps: showInternals ? internal : [],
    data: childrenOfKind(index, id, 'data'),
    hasInternals: internal.length > 0 || (index.internals.get(id)?.length ?? 0) > 0,
  };
}

export function expandedHeight(index: DeckIndex, id: Id, showInternals: boolean): number {
  const block = index.byId.get(id);
  const p = expandedPlan(index, id, showInternals);
  return (
    FRAME +
    TITLE +
    (block?.summary ? SUMMARY : 0) +
    (p.notes.length ? GAP + p.notes.length * ROW : 0) +
    (p.ops.length ? SECTION + p.ops.length * OP : 0) +
    p.internalOps.length * OP_INTERNAL +
    (p.data.length ? SECTION + p.data.length * ROW : 0) +
    FOOT
  );
}

export function blockHeight(index: DeckIndex, id: Id, st: SizeState): number {
  let h = st.expanded.has(id) ? expandedHeight(index, id, st.internals.has(id)) : collapsedHeight(index, id);
  if (st.testsOpen(id)) {
    const rows = drawerRows(index, id, st.run);
    if (rows.length) h += DRAWER + rows.length * ROW;
  }
  return h;
}

/** Vertical offset of each operation row inside an expanded card, for the internals arcs. */
export function opOffsets(index: DeckIndex, id: Id, showInternals: boolean): Map<Id, number> {
  const block = index.byId.get(id);
  const p = expandedPlan(index, id, showInternals);
  const out = new Map<Id, number>();
  let y = 12 + TITLE + (block?.summary ? SUMMARY : 0) + (p.notes.length ? GAP + p.notes.length * ROW : 0);
  if (p.ops.length) y += SECTION;
  for (const op of p.ops) {
    out.set(op.id, y + OP / 2);
    y += OP;
  }
  for (const op of p.internalOps) {
    out.set(op.id, y + OP_INTERNAL / 2);
    y += OP_INTERNAL;
  }
  return out;
}
