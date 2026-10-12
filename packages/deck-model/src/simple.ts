// The simple deck (spec §3.13): the same program as a handful of large parts with a few plain
// sentences each, and one labelled connection between any two of them. It is derived from the
// full deck, so it can never show something the full deck does not have.
import { bestBullet, type DeckIndex, isInternal } from './derive.ts';
import type { Bullet, DeckEdge, DeckNode, DeckNotes, EdgeKind, Id } from './types.ts';
import { splitIdentifier } from './util.ts';

/** One line of plain language, and where its words came from. */
export interface PlainLine {
  id: Id;
  text: string;
  origin: Bullet['origin'];
  /** For words taken from the code: a doc comment, or names alone. */
  basis?: 'doc' | 'name';
  /** The block or operation the words were taken from. */
  from?: Id;
}

export interface SimplePart {
  /** The top-level area this part stands for, or a block that sits outside every area. */
  id: Id;
  node: DeckNode;
  name: string;
  summary?: PlainLine;
  /** What it does: a summarizer's lines when there are any, otherwise lines taken from the code. */
  described: PlainLine[];
  /** What people asked of it on the map, oldest first. Pending requests are among these. */
  asked: PlainLine[];
  /** Blocks inside, at any depth. */
  blocks: Id[];
  /** Everything inside, and the part itself. */
  members: Set<Id>;
  /** Packages and services its blocks use. Runtime built-ins are left out. */
  externals: DeckNode[];
  /** Parts it asks things of, and parts that ask things of it. */
  uses: Id[];
  usedBy: Id[];
  /**
   * Used by most other parts while asking nothing of any of them. It is drawn as common
   * ground, with the parts that use it named in words and no arrow drawn to it.
   */
  common: boolean;
}

export interface SimpleLink {
  id: string; // "sln:<from>:<to>"
  from: Id;
  to: Id;
  edges: DeckEdge[];
  label: PlainLine;
  /** What is asked along it, one line per distinct thing. */
  asks: PlainLine[];
  /** Only builds the other part and asks nothing of it by name: wiring, not conversation. */
  wiring: boolean;
  /** Left out of the picture so it stays readable: busier connections were drawn instead. */
  minor: boolean;
  /** Not drawn: it arrives at a common part, which names its users in words, or it is wiring. */
  hidden: boolean;
}

export interface SimpleDeck {
  parts: SimplePart[];
  partById: Map<Id, SimplePart>;
  links: SimpleLink[];
  linkById: Map<string, SimpleLink>;
  /** The part a block, operation or area belongs to. */
  partOf: Map<Id, Id>;
  /** The connection an edge is part of. */
  linkOf: Map<Id, string>;
  /** How many connections between parts exist in the code, and how many of them are drawn. */
  connections: { built: number; drawn: number };
}

const CANVAS_KINDS = new Set<EdgeKind>(['call', 'api', 'event']);
const MAX_DESCRIBED = 12;

export const connectionKey = (from: Id, to: Id): string => `${from}>${to}`;
export const simpleLinkId = (from: Id, to: Id): string => `sln:${from}:${to}`;

const READS = new Set(
  'get list find fetch read load lookup look search query has is can check count show view all by available exists report total price validate format compute calculate parse describe peek'.split(
    ' ',
  ),
);
const WRITES = new Set(
  'create add save set update put write store insert record register place remove delete cancel clear adjust receive publish discontinue reset erase edit change move rename archive restore'.split(
    ' ',
  ),
);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** "Reserve stock" -> "reserve stock". Acronyms and names keep their capitals. */
function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

function plural(word: string): string {
  if (/(s|x|z|ch|sh)$/.test(word)) return word.endsWith('s') ? word : `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** A part's name inside a sentence: "Catalog" -> "catalog", "HTTP" stays. */
function inSentence(name: string): string {
  return /^[A-Z][a-z]+( [a-z]+)*$/.test(name) ? name.toLowerCase() : name;
}

function lineOf(b: Bullet, from?: Id): PlainLine {
  return { id: b.id, text: b.text, origin: b.origin, ...(b.basis ? { basis: b.basis } : {}), from };
}

const fromNames = (id: Id, text: string, from?: Id): PlainLine => ({
  id,
  text,
  origin: 'declared',
  basis: 'name',
  from,
});

export function buildSimple(index: DeckIndex, notes?: DeckNotes | null): SimpleDeck {
  const system = index.system.id;
  const parts: SimplePart[] = [];
  const partById = new Map<Id, SimplePart>();
  const partOf = new Map<Id, Id>();

  for (const top of index.children.get(system) ?? []) {
    if (top.kind !== 'area' && top.kind !== 'block') continue;
    const part: SimplePart = {
      id: top.id,
      node: top,
      name: top.name,
      described: [],
      asked: [],
      blocks: [],
      members: new Set(),
      externals: [],
      uses: [],
      usedBy: [],
      common: false,
    };
    const walk = (node: DeckNode) => {
      part.members.add(node.id);
      partOf.set(node.id, top.id);
      if (node.kind === 'block') part.blocks.push(node.id);
      for (const kid of index.children.get(node.id) ?? []) walk(kid);
    };
    walk(top);
    parts.push(part);
    partById.set(part.id, part);
  }

  // ---- Connections: every call, API and event that crosses from one part into another.
  const links: SimpleLink[] = [];
  const linkById = new Map<string, SimpleLink>();
  const linkOf = new Map<Id, string>();
  const calledFrom = new Map<Id, Set<Id>>(); // operation or block -> the parts that call it
  for (const e of index.snapshot.edges) {
    const a = partOf.get(e.from);
    const target = index.byId.get(e.to);
    if (!a || !target) continue;
    if (target.kind === 'external') {
      const list = partById.get(a)!.externals;
      // A runtime's own modules are not something the system depends on from outside.
      if (!list.includes(target) && !/^(node|bun|deno):/.test(target.name)) list.push(target);
      continue;
    }
    const b = partOf.get(e.to);
    if (!b || a === b || !CANVAS_KINDS.has(e.kind)) continue;
    const id = simpleLinkId(a, b);
    let link = linkById.get(id);
    if (!link) {
      link = {
        id,
        from: a,
        to: b,
        edges: [],
        label: fromNames(id, ''),
        asks: [],
        wiring: false,
        minor: false,
        hidden: false,
      };
      linkById.set(id, link);
      links.push(link);
    }
    link.edges.push(e);
    linkOf.set(e.id, id);
    let callers = calledFrom.get(e.to);
    if (!callers) {
      callers = new Set();
      calledFrom.set(e.to, callers);
    }
    callers.add(a);
  }
  const order = new Map(index.snapshot.nodes.map((n, i) => [n.id, i]));
  for (const link of links) {
    // Building another part's objects is how a program is assembled. Unless something is
    // also asked of that part, or requested of it, there is nothing to say on an arrow.
    link.wiring = link.edges.every(
      (e) => e.evidence.length > 0 && index.byId.get(e.to)?.kind !== 'operation',
    );
    if (link.wiring || !link.edges.some((e) => e.evidence.length > 0)) continue;
    partById.get(link.from)!.uses.push(link.to);
    partById.get(link.to)!.usedBy.push(link.from);
  }
  for (const part of parts) {
    const others = parts.length - 1;
    part.common =
      part.usedBy.length >= 3 &&
      part.usedBy.length >= others * 0.6 &&
      part.uses.length * 4 <= part.usedBy.length;
  }
  // A connection into common ground is said in words on the bar. One that is only asked for
  // is always drawn: it is the thing being looked at.
  for (const link of links)
    link.hidden =
      link.wiring || (partById.get(link.to)!.common && link.edges.some((e) => e.evidence.length > 0));

  // A picture with a line between every pair of parts says nothing. When there are more
  // connections than a person can take in, the busiest are drawn and the rest are named in
  // the panel. Every part keeps its busiest one, and what is only asked for is always drawn.
  const isBuilt = (l: SimpleLink) => l.edges.some((e) => e.evidence.length > 0);
  const candidates = links.filter((l) => !l.hidden && isBuilt(l));
  const limit = Math.max(10, Math.round(parts.length * 1.5));
  if (candidates.length > limit) {
    const busiest = [...candidates].sort(
      (x, y) => y.edges.length - x.edges.length || x.id.localeCompare(y.id),
    );
    const keep = new Set<SimpleLink>();
    for (const part of parts) {
      const mine = busiest.find((l) => l.from === part.id || l.to === part.id);
      if (mine) keep.add(mine);
    }
    for (const l of busiest) {
      if (keep.size >= limit) break;
      keep.add(l);
    }
    for (const l of candidates) {
      if (keep.has(l)) continue;
      l.minor = true;
      l.hidden = true;
    }
  }
  const connections = {
    built: links.filter((l) => isBuilt(l) && !l.wiring && !partById.get(l.to)!.common).length,
    drawn: links.filter((l) => isBuilt(l) && !l.hidden).length,
  };

  // ---- What each part is for, and what it does.
  for (const part of parts) {
    const node = part.node;
    const blocks = part.blocks.map((id) => index.byId.get(id)!).filter(Boolean);
    const lead =
      node.kind === 'block'
        ? node
        : (blocks.find((b) => norm(b.name) === norm(node.name)) ??
          blocks.find(
            (b) => norm(plural(b.name)) === norm(node.name) || norm(b.name) === norm(plural(node.name)),
          ));

    const own = notes?.plain?.summaries?.[part.id];
    if (own) part.summary = { id: `${part.id}:plain`, text: own, origin: 'authored' };
    else if (node.summary) part.summary = lineOf(node.summary);
    else if (lead?.summary) part.summary = lineOf(lead.summary, lead.id);
    else {
      // No block speaks for the whole area. In a small one, a block whose summary names the
      // area comes close. In a large one no single block does, and its blocks are listed.
      const word = new RegExp(`\\b${node.name.replace(/[^A-Za-z0-9 ]/g, '')}\\b`, 'i');
      const named =
        blocks.length <= 6 ? blocks.find((b) => b.summary && word.test(b.summary.text)) : undefined;
      if (named?.summary) part.summary = lineOf(named.summary, named.id);
      else if (blocks.length > 1) {
        const names = blocks.slice(0, blocks.length <= 5 ? 5 : 4).map((b) => b.name);
        const rest = blocks.length - names.length;
        part.summary = fromNames(
          `${part.id}:names`,
          rest > 0 ? `${names.join(', ')} and ${rest} more` : listOf(names),
        );
      }
    }

    for (const b of node.bullets) if (b.origin === 'authored') part.asked.push(lineOf(b));
    const written = node.bullets.filter((b) => b.origin !== 'authored');
    if (written.length) {
      part.described = written.map((b) => lineOf(b));
      continue;
    }

    // Taken from the code: what other parts ask of this one first, then what its leading
    // block offers, then its entry points, then the rest. Only lines somebody wrote as a
    // sentence are used. A name alone ("Get", "Ok") says too little at this level.
    const seen = new Set<string>(part.summary ? [norm(part.summary.text)] : []);
    const ranked: { line: PlainLine; rank: number; order: number }[] = [];
    let order = 0;
    for (const block of blocks) {
      for (const op of index.children.get(block.id) ?? []) {
        if (op.kind !== 'operation' || isInternal(op)) continue;
        order += 1;
        const best = bestBullet(op);
        if (!best || (best.origin === 'declared' && best.basis === 'name')) continue;
        const key = norm(best.text);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const callers = calledFrom.get(op.id)?.size ?? 0;
        const rank =
          callers > 0
            ? -callers
            : block === lead
              ? 1
              : op.tags?.includes('api') || block.tags?.includes('entry')
                ? 2
                : 3;
        ranked.push({ line: lineOf(best, op.id), rank, order });
      }
    }
    ranked.sort((x, y) => x.rank - y.rank || x.order - y.order);
    // What a part is asked for and what its leading block offers say what it is for. The
    // helpers behind them are detail, used only when there is little else to go on.
    const face = ranked.filter((r) => r.rank <= 1);
    part.described = (face.length >= 2 ? face : ranked).slice(0, MAX_DESCRIBED).map((r) => r.line);
  }

  // ---- What each connection carries, in a few words.
  const written = index.snapshot.connections ?? {};
  for (const link of links) {
    const to = partById.get(link.to)!;
    const real = link.edges.filter((e) => e.evidence.length > 0);
    const asked = link.edges.filter((e) => e.evidence.length === 0 && (e.label || e.bullets.length));

    // What is asked: the operations called across the boundary, and anything an accepted
    // request named. A constructor call is wiring and asks for nothing by name.
    const asks: PlainLine[] = [];
    const ops: DeckNode[] = [];
    const seen = new Set<string>();
    const add = (line: PlainLine) => {
      const key = norm(line.text);
      if (!key || seen.has(key)) return;
      seen.add(key);
      asks.push(line);
    };
    for (const e of real) {
      const noted = notes?.edges?.[e.id]?.label ?? (e.kind === 'call' ? e.label : undefined);
      if (noted) add({ id: `${e.id}:label`, text: noted, origin: 'authored' });
    }
    const named = asks.length;
    for (const e of real) {
      const target = index.byId.get(e.to);
      if (target?.kind === 'operation' && !ops.includes(target)) ops.push(target);
    }
    // In the order the far end declares them, which is the order its own card lists them in.
    ops.sort((x, y) => (order.get(x.id) ?? 0) - (order.get(y.id) ?? 0));
    for (const op of ops) {
      const best = bestBullet(op);
      if (best) add(lineOf(best, op.id));
    }
    for (const e of asked) {
      const text = e.label ?? e.bullets[0]?.text;
      if (text) add({ id: e.id, text, origin: 'authored' });
    }
    link.asks = asks;

    const key = connectionKey(link.from, link.to);
    const own = notes?.plain?.connections?.[key];
    const given = written[key];
    const id = `${link.id}:label`;
    if (own) link.label = { id, text: own, origin: 'authored' };
    else if (real.length === 0 && asked.length > 0) {
      // Nothing is built yet: the label is the request, in the words it was made in.
      const texts = asked.map((e) => e.label ?? e.bullets[0]!.text);
      link.label = {
        id,
        text: texts.length > 2 ? `${texts[0]} and ${texts.length - 1} more` : texts.join(' and '),
        origin: 'authored',
      };
    } else if (named > 0) {
      // Built from a request that was accepted: it keeps the words it was asked in, ahead
      // of anything a summarizer would say about it.
      const texts = asks.slice(0, named).map((l) => lowerFirst(l.text));
      link.label = {
        id,
        text: texts.length > 2 ? `${texts[0]} and more` : listOf(texts),
        origin: 'authored',
      };
    } else if (given) link.label = { ...given, id };
    else if (to.common) link.label = fromNames(id, `uses ${inSentence(to.name)}`);
    else link.label = derivedLabel(id, ops, asks, inSentence(to.name));
  }

  return { parts, partById, links, linkById, partOf, linkOf, connections };
}

/** A label made from the code alone: the operations one part calls on another. */
function derivedLabel(id: Id, ops: DeckNode[], asks: PlainLine[], target: string): PlainLine {
  if (ops.length === 0) return fromNames(id, `sets up ${target}`);
  // A doc comment makes a label only when it reads as something being asked for.
  const sentences = asks.filter(
    (l) =>
      !(l.origin === 'declared' && l.basis === 'name') &&
      l.text.length <= 60 &&
      !/^(`|the |this |a |an |whether |if |when )/i.test(l.text),
  );
  if (ops.length === 1 && sentences.length === 1)
    return { ...sentences[0]!, id, text: lowerFirst(sentences[0]!.text) };
  if (
    ops.length === 2 &&
    sentences.length === 2 &&
    sentences[0]!.text.length + sentences[1]!.text.length <= 52
  )
    return { ...sentences[0]!, id, text: listOf(sentences.map((l) => lowerFirst(l.text))) };

  const words = ops.map((op) =>
    splitIdentifier(
      op.name
        .split(/[.:]/)
        .at(-1)!
        .replace(/^[A-Z]+ \//, ''),
    ),
  );
  const verbs = [...new Set(words.map((w) => w[0] ?? ''))].filter(Boolean);
  const object = words[0]?.at(-1);
  // placeOrder, getOrder, cancelOrder -> "place, get and cancel orders"
  if (object && verbs.length <= 4 && words.every((w) => w.length >= 2 && w.at(-1) === object))
    return fromNames(id, `${listOf(verbs)} ${ops.length > 1 ? plural(object) : object}`);
  const reads = verbs.filter((v) => READS.has(v)).length;
  const writes = verbs.filter((v) => WRITES.has(v)).length;
  if (reads === verbs.length) return fromNames(id, `gets ${target} information`);
  if (writes === verbs.length) return fromNames(id, `updates ${target}`);
  if (reads + writes === verbs.length) return fromNames(id, `reads and updates ${target}`);
  if (verbs.length >= 2 && verbs.length <= 3 && words.every((w) => w.length === 1))
    return fromNames(id, listOf(verbs));
  return fromNames(id, `uses ${target}`);
}
