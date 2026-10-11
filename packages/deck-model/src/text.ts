import { bestBullet, type DeckIndex, isInternal, operationsOf, shortSignature } from './derive.ts';
import type { Bullet, ChangeOp, DeckNode, Id } from './types.ts';

const COL = 44;

const MARK: Record<Bullet['origin'], string> = { declared: '•', summarized: '◦', authored: '▪' };

function row(left: string, right?: string): string {
  if (!right) return left;
  return left.length >= COL - 1 ? `${left}  ${right}` : left.padEnd(COL) + right;
}

export interface DeckTextOptions {
  /** Limit the outline to these blocks and their neighbors. */
  focus?: Iterable<Id>;
  /** Pending operations, rendered in place and marked [requested]. */
  operations?: readonly ChangeOp[];
}

/**
 * The deck as a plain-text outline (spec §4.4): the accessible equivalent of the map,
 * the context handed to agents, and a diffable record of the architecture.
 */
export function renderDeckText(index: DeckIndex, options: DeckTextOptions = {}): string {
  const ops = options.operations ?? [];
  const name = (id: Id): string => {
    const added = ops.find((o) => o.type === 'add_block' && o.id === id);
    if (added && added.type === 'add_block') return added.name;
    return index.byId.get(index.blockOf.get(id) ?? id)?.name ?? id;
  };

  let focus: Set<Id> | null = null;
  if (options.focus) {
    focus = new Set<Id>();
    for (const id of options.focus) {
      const block = index.blockOf.get(id) ?? id;
      focus.add(block);
      for (const l of index.linksOut.get(block) ?? []) focus.add(l.to);
      for (const l of index.linksIn.get(block) ?? []) focus.add(l.from);
    }
    for (const op of ops) {
      if (op.type === 'add_edge') {
        focus.add(index.blockOf.get(op.from) ?? op.from);
        focus.add(index.blockOf.get(op.to) ?? op.to);
      }
    }
  }

  const renames = new Map<Id, string>();
  const removed = new Set<Id>();
  const rewrites = new Map<Id, { text: string; before: string }>();
  const addedBullets = new Map<Id, string[]>();
  for (const op of ops) {
    if (op.type === 'rename') renames.set(op.targetId, op.name);
    else if (op.type === 'remove') removed.add(op.targetId);
    else if (op.type === 'set_behavior') rewrites.set(op.bulletId, { text: op.text, before: op.before });
    else if (op.type === 'add_behavior')
      addedBullets.set(op.targetId, [...(addedBullets.get(op.targetId) ?? []), op.text]);
  }
  const tag = (id: Id): string =>
    removed.has(id)
      ? '  [remove requested]'
      : renames.has(id)
        ? `  [rename requested: ${renames.get(id)}]`
        : '';

  const out: string[] = [`# ${index.system.name}`];

  const bulletLine = (b: Bullet, right?: string): string => {
    const rewrite = rewrites.get(b.id);
    if (removed.has(b.id)) return row(`${MARK[b.origin]} ${b.text}`, '[remove requested]');
    if (rewrite) return row(`▪ ${rewrite.text}`, `[requested; was "${rewrite.before}"]`);
    return row(`${MARK[b.origin]} ${b.text}`, right);
  };

  const renderBlock = (block: DeckNode, depth: number) => {
    const hashes = '#'.repeat(Math.min(6, depth + 1));
    out.push(row(`${hashes} block: ${block.name}${tag(block.id)}`, block.source[0]?.path));
    if (block.summary) out.push(`${block.summary.text.replace(/\.$/, '')}.`);
    for (const b of block.bullets) if (b.origin === 'authored') out.push(bulletLine(b));
    for (const op of operationsOf(index, block.id)) {
      if (isInternal(op)) continue;
      const b = bestBullet(op);
      const sig = op.signature ? shortSignature(op.signature) : op.name;
      if (b) out.push(bulletLine(b, sig + tag(op.id)));
      else out.push(row(`• ${op.name}`, sig + tag(op.id)));
      for (const text of addedBullets.get(op.id) ?? []) out.push(row(`▪ ${text}`, '[requested]'));
    }
    for (const b of block.bullets) if (b.origin !== 'authored') out.push(bulletLine(b));
    for (const text of addedBullets.get(block.id) ?? []) out.push(row(`▪ ${text}`, '[requested]'));
    if (block.coverage !== 'full') {
      const gaps = index.gapsOf.get(block.id)?.length ?? 0;
      out.push(
        `? ${block.coverage}: ${gaps} construct${gaps === 1 ? '' : 's'} the extractor could not follow`,
      );
    }
    for (const l of index.linksOut.get(block.id) ?? []) {
      const kind = l.label ?? 'call';
      const via = l.indirect ? ` (${l.indirect})` : '';
      out.push(
        `-> ${name(l.to)}: ${kind}${via}${l.edges.some((e) => removed.has(e.id)) ? '  [remove requested]' : ''}`,
      );
    }
    for (const ext of index.externalsOf.get(block.id) ?? []) out.push(`-> ${ext.name}: external`);
    for (const l of index.linksIn.get(block.id) ?? []) out.push(`<- ${name(l.from)}: ${l.label ?? 'call'}`);
    for (const op of ops) {
      if (op.type !== 'add_edge') continue;
      const from = index.blockOf.get(op.from) ?? op.from;
      const to = index.blockOf.get(op.to) ?? op.to;
      const kind =
        op.kind === 'api'
          ? `API${op.label ? ` ${op.label}` : ''}`
          : op.kind + (op.label ? ` ${op.label}` : '');
      if (from === block.id) {
        out.push(row(`-> ${name(to)}: ${kind}`, '[requested]'));
        for (const text of op.bullets) out.push(row(`   ▪ ${text}`, '[requested]'));
      } else if (to === block.id) out.push(row(`<- ${name(from)}: ${kind}`, '[requested]'));
    }
  };

  const hasFocus = (area: DeckNode): boolean => {
    if (!focus) return true;
    for (const c of index.children.get(area.id) ?? []) {
      if (c.kind === 'block' && focus.has(c.id)) return true;
      if (c.kind === 'area' && hasFocus(c)) return true;
    }
    return ops.some((o) => o.type === 'add_block' && o.parentId === area.id);
  };

  const renderArea = (area: DeckNode, depth: number) => {
    if (!hasFocus(area)) return;
    out.push(`${'#'.repeat(Math.min(6, depth + 1))} area: ${area.name}${tag(area.id)}`);
    for (const c of index.children.get(area.id) ?? []) {
      if (c.kind === 'area') renderArea(c, depth + 1);
      else if (c.kind === 'block' && (!focus || focus.has(c.id))) renderBlock(c, depth + 1);
    }
    for (const op of ops) {
      if (op.type !== 'add_block' || op.parentId !== area.id) continue;
      out.push(row(`${'#'.repeat(Math.min(6, depth + 2))} block: ${op.name}`, '[requested: new block]'));
      for (const text of op.bullets) out.push(row(`▪ ${text}`, '[requested]'));
    }
  };

  for (const c of index.children.get(index.system.id) ?? []) {
    if (c.kind === 'area') renderArea(c, 1);
    else if (c.kind === 'block' && (!focus || focus.has(c.id))) renderBlock(c, 1);
  }
  for (const op of ops) {
    if (op.type !== 'add_block' || op.parentId !== index.system.id) continue;
    out.push(row(`## block: ${op.name}`, '[requested: new block]'));
    for (const text of op.bullets) out.push(row(`▪ ${text}`, '[requested]'));
  }
  return `${out.join('\n')}\n`;
}

/** One line per operation, for change titles and the tray. */
export function describeOp(index: DeckIndex, op: ChangeOp, all: readonly ChangeOp[] = []): string {
  const name = (id: Id): string => {
    const added = all.find((o) => o.type === 'add_block' && o.id === id);
    if (added && added.type === 'add_block') return added.name;
    const node = index.byId.get(id);
    if (node) return node.name;
    const edge = index.edgeById.get(id);
    if (edge)
      return `${name(index.blockOf.get(edge.from) ?? edge.from)} → ${name(index.blockOf.get(edge.to) ?? edge.to)}`;
    const link = index.linkById.get(id);
    if (link) return `${name(link.from)} → ${name(link.to)}`;
    return id;
  };
  switch (op.type) {
    case 'set_behavior':
      return `Change “${op.before}” to “${op.text}” on ${name(index.blockOf.get(op.targetId) ?? op.targetId)}`;
    case 'add_behavior':
      return `Add “${op.text}” to ${name(op.targetId)}`;
    case 'add_edge': {
      const kind = op.kind === 'api' ? 'API' : op.kind;
      return `New ${kind} arrow ${name(op.from)} → ${name(op.to)}${op.label ? `: ${op.label}` : ''}`;
    }
    case 'add_block':
      return `New block “${op.name}” in ${name(op.parentId)}`;
    case 'rename':
      return `Rename ${op.before} to ${op.name}`;
    case 'remove':
      return `Remove ${op.label}`;
  }
}
