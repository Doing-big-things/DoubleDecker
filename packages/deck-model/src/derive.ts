import type {
  Bullet,
  DeckEdge,
  DeckNode,
  DeckNotes,
  DeckSnapshot,
  DeckTest,
  EdgeKind,
  Gap,
  Id,
  TestRun,
} from './types.ts';

/** A rolled-up arrow between two blocks (or two top-level areas). */
export interface Link {
  id: string;
  from: Id;
  to: Id;
  edges: DeckEdge[];
  kinds: EdgeKind[];
  count: number;
  label?: string;
  indirect?: string;
}

export interface CardBullet {
  bullet: Bullet;
  ownerId: Id; // the block or operation the bullet belongs to
  opId?: Id;
}

export interface DeckIndex {
  snapshot: DeckSnapshot;
  system: DeckNode;
  byId: Map<Id, DeckNode>;
  edgeById: Map<Id, DeckEdge>;
  children: Map<Id, DeckNode[]>;
  areas: DeckNode[];
  blocks: DeckNode[];
  /** Enclosing block of an operation or data node; a block maps to itself. */
  blockOf: Map<Id, Id>;
  /** Arrows between blocks, one per ordered pair. Data and dependency edges are left out. */
  links: Link[];
  linkById: Map<string, Link>;
  linksIn: Map<Id, Link[]>;
  linksOut: Map<Id, Link[]>;
  /** One per ordered pair of top-level areas. */
  areaLinks: Link[];
  /** Data edges between blocks: hidden on the canvas, listed in the panel. */
  dataLinks: Link[];
  /** Call edges between operations of the same block. */
  internals: Map<Id, DeckEdge[]>;
  externalsOf: Map<Id, DeckNode[]>;
  testsOf: Map<Id, DeckTest[]>;
  gapsOf: Map<Id, Gap[]>;
}

const CANVAS_KINDS = new Set<EdgeKind>(['call', 'api', 'event']);

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Merge authored bullets in and drop dismissed summaries. Returns a new snapshot. */
export function withNotes(snapshot: DeckSnapshot, notes: DeckNotes | null): DeckSnapshot {
  if (!notes) return snapshot;
  const dismissed = new Set(notes.dismissed);
  const marked = notes.edges ?? {};
  const hasNotes = Object.keys(notes.bullets).length > 0 || dismissed.size > 0 || Object.keys(marked).length > 0;
  if (!hasNotes) return snapshot;
  const apply = <T extends { id: Id; bullets: Bullet[] }>(item: T): T => {
    const extra = notes.bullets[item.id];
    const kept = item.bullets.filter((b) => !dismissed.has(b.id));
    if (!extra && kept.length === item.bullets.length) return item;
    return { ...item, bullets: [...(extra ?? []), ...kept] };
  };
  return {
    ...snapshot,
    nodes: snapshot.nodes.map(apply),
    edges: snapshot.edges.map((e) => {
      const noted = apply(e);
      const mark = marked[e.id];
      return mark ? { ...noted, kind: mark.kind, label: mark.label ?? noted.label } : noted;
    }),
  };
}

export function buildIndex(snapshot: DeckSnapshot): DeckIndex {
  const byId = new Map<Id, DeckNode>();
  const children = new Map<Id, DeckNode[]>();
  for (const n of snapshot.nodes) byId.set(n.id, n);
  let system: DeckNode | undefined;
  for (const n of snapshot.nodes) {
    if (n.kind === 'system') system = n;
    if (n.parentId) push(children, n.parentId, n);
  }
  if (!system) {
    system = { id: 'sys_empty', kind: 'system', name: 'empty', parentId: null, bullets: [], source: [], coverage: 'full' };
  }

  const blockOf = new Map<Id, Id>();
  const areas: DeckNode[] = [];
  const blocks: DeckNode[] = [];
  for (const n of snapshot.nodes) {
    if (n.kind === 'area') areas.push(n);
    else if (n.kind === 'block') {
      blocks.push(n);
      blockOf.set(n.id, n.id);
    }
  }
  for (const n of snapshot.nodes) {
    if ((n.kind === 'operation' || n.kind === 'data') && n.parentId) {
      const parent = byId.get(n.parentId);
      if (parent?.kind === 'block') blockOf.set(n.id, parent.id);
      else if (parent && blockOf.has(parent.id)) blockOf.set(n.id, blockOf.get(parent.id)!);
    }
  }

  const topAreaOf = (id: Id): Id | undefined => {
    let cur = byId.get(id);
    let top: Id | undefined;
    while (cur && cur.kind !== 'system') {
      if (cur.kind === 'area') top = cur.id;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return top;
  };

  const edgeById = new Map<Id, DeckEdge>();
  const linkMap = new Map<string, Link>();
  const dataMap = new Map<string, Link>();
  const areaMap = new Map<string, Link>();
  const internals = new Map<Id, DeckEdge[]>();
  const externalsOf = new Map<Id, DeckNode[]>();

  const addTo = (map: Map<string, Link>, prefix: string, from: Id, to: Id, e: DeckEdge) => {
    const key = `${prefix}:${from}:${to}`;
    let link = map.get(key);
    if (!link) {
      link = { id: key, from, to, edges: [], kinds: [], count: 0 };
      map.set(key, link);
    }
    link.edges.push(e);
    link.count += 1;
    if (!link.kinds.includes(e.kind)) link.kinds.push(e.kind);
    if (e.indirect && !link.indirect) link.indirect = e.indirect;
  };

  for (const e of snapshot.edges) {
    edgeById.set(e.id, e);
    const toNode = byId.get(e.to);
    const fromBlock = blockOf.get(e.from);
    if (!fromBlock || !toNode) continue;
    if (toNode.kind === 'external') {
      const list = externalsOf.get(fromBlock);
      if (!list) externalsOf.set(fromBlock, [toNode]);
      else if (!list.includes(toNode)) list.push(toNode);
      continue;
    }
    const toBlock = blockOf.get(e.to);
    if (!toBlock) continue;
    if (fromBlock === toBlock) {
      if (e.kind === 'call') push(internals, fromBlock, e);
      continue;
    }
    if (!CANVAS_KINDS.has(e.kind)) {
      addTo(dataMap, 'dat', fromBlock, toBlock, e);
      continue;
    }
    addTo(linkMap, 'lnk', fromBlock, toBlock, e);
    const fa = topAreaOf(fromBlock);
    const ta = topAreaOf(toBlock);
    if (fa && ta && fa !== ta) addTo(areaMap, 'aln', fa, ta, e);
  }

  const links = [...linkMap.values()];
  const linksIn = new Map<Id, Link[]>();
  const linksOut = new Map<Id, Link[]>();
  for (const link of links) {
    link.label = linkLabel(link);
    push(linksOut, link.from, link);
    push(linksIn, link.to, link);
  }

  const testsOf = new Map<Id, DeckTest[]>();
  for (const t of snapshot.tests) {
    const seen = new Set<Id>();
    for (const target of t.targets) {
      if (!seen.has(target.id)) {
        seen.add(target.id);
        push(testsOf, target.id, t);
      }
      const block = blockOf.get(target.id);
      if (block && !seen.has(block)) {
        seen.add(block);
        push(testsOf, block, t);
      }
    }
  }

  const gapsOf = new Map<Id, Gap[]>();
  for (const g of snapshot.gaps) push(gapsOf, g.ownerId, g);

  return {
    snapshot,
    system,
    byId,
    edgeById,
    children,
    areas,
    blocks,
    blockOf,
    links,
    linkById: linkMap,
    linksIn,
    linksOut,
    areaLinks: [...areaMap.values()],
    dataLinks: [...dataMap.values()],
    internals,
    externalsOf,
    testsOf,
    gapsOf,
  };
}

/** The label pill of an arrow. Plain calls have none: the label shows kind, the line shows state. */
export function linkLabel(link: { edges: DeckEdge[]; kinds: EdgeKind[] }): string | undefined {
  const named = (kind: EdgeKind) => {
    const labels = [...new Set(link.edges.filter((e) => e.kind === kind && e.label).map((e) => e.label!))];
    if (labels.length === 0) return '';
    return labels.length === 1 ? labels[0]! : `${labels[0]} +${labels.length - 1}`;
  };
  if (link.kinds.includes('api')) {
    const n = named('api');
    return n ? `API · ${n}` : 'API';
  }
  if (link.kinds.includes('event')) {
    const n = named('event');
    return n ? `event · ${n}` : 'event';
  }
  return undefined;
}

export function childrenOfKind(index: DeckIndex, id: Id, kind: DeckNode['kind']): DeckNode[] {
  return (index.children.get(id) ?? []).filter((n) => n.kind === kind);
}

export function isInternal(node: DeckNode): boolean {
  return node.tags?.includes('internal') ?? false;
}

/** Public operations of a block, in declaration order. */
export function operationsOf(index: DeckIndex, blockId: Id): DeckNode[] {
  return childrenOfKind(index, blockId, 'operation');
}

/** The single bullet an operation shows: authored, then doc comment, then AI summary, then its name. */
export function bestBullet(node: DeckNode): Bullet | undefined {
  const rank = (b: Bullet) =>
    b.origin === 'authored' ? 0 : b.origin === 'declared' && b.basis !== 'name' ? 1 : b.origin === 'summarized' ? 2 : 3;
  let best: Bullet | undefined;
  for (const b of node.bullets) if (!best || rank(b) < rank(best)) best = b;
  return best;
}

/** What the block's card lists: authored notes, then one bullet per public operation, then AI notes. */
export function cardBullets(index: DeckIndex, blockId: Id): CardBullet[] {
  const block = index.byId.get(blockId);
  if (!block) return [];
  const out: CardBullet[] = [];
  for (const b of block.bullets) if (b.origin === 'authored') out.push({ bullet: b, ownerId: blockId });
  for (const op of operationsOf(index, blockId)) {
    if (isInternal(op)) continue;
    const b = bestBullet(op);
    if (b) out.push({ bullet: b, ownerId: op.id, opId: op.id });
  }
  for (const b of block.bullets) if (b.origin !== 'authored') out.push({ bullet: b, ownerId: blockId });
  return out;
}

/** Ancestors from the system down to the node itself. */
export function pathTo(index: DeckIndex, id: Id): DeckNode[] {
  const path: DeckNode[] = [];
  let cur = index.byId.get(id);
  while (cur) {
    path.unshift(cur);
    cur = cur.parentId ? index.byId.get(cur.parentId) : undefined;
  }
  return path;
}

/** All blocks inside an area, at any depth. */
export function blocksUnder(index: DeckIndex, areaId: Id): DeckNode[] {
  const out: DeckNode[] = [];
  const walk = (id: Id) => {
    for (const c of index.children.get(id) ?? []) {
      if (c.kind === 'block') out.push(c);
      else if (c.kind === 'area') walk(c.id);
    }
  };
  walk(areaId);
  return out;
}

export interface TestStats {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  notRun: number;
  state: 'none' | 'notrun' | 'pass' | 'partial' | 'fail';
}

/** Status comes only from a run at the current tree. Anything older counts as not run. */
export function testStats(tests: readonly DeckTest[], run: TestRun | null): TestStats {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const t of tests) {
    const s = run?.results[t.id];
    if (s === 'passed') passed += 1;
    else if (s === 'failed') failed += 1;
    else if (s === 'skipped') skipped += 1;
  }
  const total = tests.length;
  const notRun = total - passed - failed - skipped;
  const state =
    total === 0 ? 'none' : failed > 0 ? 'fail' : passed === total ? 'pass' : passed > 0 || skipped > 0 ? 'partial' : 'notrun';
  return { total, passed, failed, skipped, notRun, state };
}

/** "✓12", "✕2/12", "12", "0". Skipped tests never count as passed. */
export function chipLabel(s: TestStats): string {
  switch (s.state) {
    case 'none':
      return '0';
    case 'fail':
      return `✕${s.failed}/${s.total}`;
    case 'pass':
      return `✓${s.total}`;
    case 'partial':
      return `✓${s.passed}/${s.total}`;
    default:
      return `${s.total}`;
  }
}

/** reserve(orderId: Id, items: Item[]): Promise<void>  ->  reserve(orderId, items) */
export function shortSignature(signature: string): string {
  const open = signature.indexOf('(');
  if (open < 0) return signature;
  let depth = 0;
  let close = -1;
  for (let i = open; i < signature.length; i++) {
    const ch = signature[i];
    if (ch === '(' || ch === '<' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === '>' || ch === ']' || ch === '}') {
      if (ch === '>' && signature[i - 1] === '=') continue;
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return signature;
  const head = signature.slice(0, open).replace(/<.*>$/, '');
  const inner = signature.slice(open + 1, close);
  const params: string[] = [];
  let cur = '';
  depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (ch === '(' || ch === '<' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === '>' && inner[i - 1] !== '=') depth -= 1;
    if (ch === ',' && depth === 0) {
      params.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) params.push(cur);
  const names = params.map((p) => {
    const t = p.trim();
    if (t.startsWith('{')) return '{…}';
    if (t.startsWith('[')) return '[…]';
    return t.split(/[?:=]/)[0]!.trim();
  });
  return `${head}(${names.join(', ')})`;
}
