// Prints a fixed sample of blocks and arrows from a deck beside the source lines they claim,
// so a person can check the map against the code (spec §11, M1).
//
//   node scripts/sample-check.mjs <deck.json from GET /api/deck> <repo root> [count]
import { readFileSync } from 'node:fs';
import path from 'node:path';

const [deckFile, root, countArg] = process.argv.slice(2);
const count = Number(countArg ?? 30);
const { snapshot } = JSON.parse(readFileSync(deckFile, 'utf8'));
const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
const files = new Map();
const line = (file, n) => {
  if (!files.has(file)) files.set(file, readFileSync(path.join(root, file), 'utf8').split('\n'));
  return (files.get(file)[n - 1] ?? '<no such line>').trim().slice(0, 150);
};
// A fixed pseudo-random order, so the same sample is drawn every time.
let seed = 20261011;
const rand = () => {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const sample = (items) =>
  [...items]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((item) => ({ item, key: rand() }))
    .sort((a, b) => a.key - b.key)
    .slice(0, count)
    .map((x) => x.item);
const blockOf = (id) => {
  let n = byId.get(id);
  while (n && n.kind !== 'block') n = byId.get(n.parentId);
  return n;
};

console.log(`# ${count} blocks\n`);
sample(snapshot.nodes.filter((n) => n.kind === 'block')).forEach((b, i) => {
  const area = byId.get(b.parentId);
  const ops = snapshot.nodes.filter((n) => n.parentId === b.id && n.kind === 'operation');
  console.log(`B${i + 1}. ${b.name}  [area: ${area?.name}]  ${b.source.map((s) => s.path).join(', ')}`);
  if (b.summary) console.log(`    summary (${b.summary.origin}/${b.summary.basis ?? ''}): ${b.summary.text}`);
  for (const op of ops.slice(0, 4)) {
    const ref = op.source[0];
    console.log(
      `    op ${op.name}${op.tags?.length ? ` [${op.tags.join(',')}]` : ''}  ${ref.path}:${ref.startLine}`,
    );
    console.log(`       | ${line(ref.path, ref.startLine)}`);
    const bullet = op.bullets[0];
    if (bullet) console.log(`       bullet (${bullet.origin}/${bullet.basis ?? ''}): ${bullet.text}`);
  }
  if (ops.length > 4) console.log(`    … ${ops.length - 4} more operations`);
  console.log('');
});

console.log(`# ${count} arrows\n`);
sample(snapshot.edges).forEach((e, i) => {
  const from = byId.get(e.from);
  const to = byId.get(e.to);
  const ev = e.evidence[0];
  const def = to?.source[0];
  console.log(
    `A${i + 1}. [${e.kind}${e.indirect ? `, ${e.indirect}` : ''}] ${blockOf(e.from)?.name}.${from?.kind === 'block' ? '(block)' : from?.name}  ->  ${blockOf(e.to)?.name}.${to?.kind === 'block' ? '(block)' : to?.name}`,
  );
  if (ev) console.log(`    evidence ${ev.path}:${ev.startLine}\n       | ${line(ev.path, ev.startLine)}`);
  if (def)
    console.log(`    target   ${def.path}:${def.startLine}\n       | ${line(def.path, def.startLine)}`);
  console.log('');
});
