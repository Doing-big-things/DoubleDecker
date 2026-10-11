import type { DeckIndex, Id, ReviewBundle } from '@decker/deck-model';

const cache = new WeakMap<ReviewBundle, Map<Id, string>>();

/**
 * Tests the agent added, changed, or deleted, per block, as a short flag for the tests chip.
 * Weakening tests is one way a candidate can look better than it is (spec §3.7).
 */
export function reviewFlags(review: ReviewBundle, index: DeckIndex): Map<Id, string> {
  const hit = cache.get(review);
  if (hit) return hit;
  const counts = new Map<Id, { added: number; changed: number; deleted: number }>();
  const add = (kind: 'added' | 'changed' | 'deleted', targets: { id: Id }[]) => {
    const blocks = new Set<Id>();
    for (const t of targets) {
      const b = index.blockOf.get(t.id);
      if (b) blocks.add(b);
    }
    for (const b of blocks) {
      const c = counts.get(b) ?? { added: 0, changed: 0, deleted: 0 };
      c[kind] += 1;
      counts.set(b, c);
    }
  };
  for (const t of review.testDelta.added) add('added', t.targets);
  for (const t of review.testDelta.changed) add('changed', t.targets);
  for (const t of review.testDelta.deleted) add('deleted', t.targets);
  const out = new Map<Id, string>();
  for (const [id, c] of counts) {
    const parts: string[] = [];
    if (c.added) parts.push(`+${c.added} new`);
    if (c.changed) parts.push(`${c.changed} changed`);
    if (c.deleted) parts.push(`${c.deleted} deleted`);
    out.set(id, parts.join(' · '));
  }
  cache.set(review, out);
  return out;
}
