// Sizes and layout of the simple view (spec §3.13). A part's size is a function of its
// text, so nothing on the canvas is measured after it is drawn. ELK places the parts in layers,
// routes every connection around them, and leaves room on each line for its label.
import type { Id, PlainLine, SimpleDeck, SimpleLink, SimplePart } from '@decker/deck-model';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import { simpleEngine } from './layout';
import type { Marks } from './pending';

export const PART_W = 360;
/** Height of the bar a common part is drawn as. */
export const BAR_H = 56;
/** Vertical measures of a part's card, in px at 100% zoom. The stylesheet uses the same numbers. */
export const PART = {
  /** The outline, in the part's own color. */
  border: 2,
  padX: 20,
  padTop: 16,
  padBottom: 12,
  title: 26,
  line: 21,
  gapSummary: 2,
  gapRows: 8,
  gapRow: 2,
  foot: 28,
  gapFoot: 8,
  marker: 15,
};
const TEXT_PX = 14.5;
const LABEL_PX = 14.5;
const LABEL_LINE = 20;
const LABEL_MAX_W = 176;
/** A label is a pill: this much room around its words. */
const LABEL_PAD_X = 14;
const LABEL_PAD_Y = 5;
/** How far a line's end keeps from a card's corner and from another line's end: each end carries a round mark. */
const END_CLEAR = 30;
const FONT = '"Inter Variable", Inter, system-ui, "Segoe UI", sans-serif';
// Canvas text is measured without the page's alternate glyphs. A little room is held back,
// so a line that is counted as fitting always does.
const SAFETY = 8;

const MAX_DESCRIBED = 4;
const MAX_ASKED = 3;
const MAX_ROWS = 7;

export interface PartRow {
  line: PlainLine;
  lines: number;
  kind: 'described' | 'asked';
  requested: boolean;
}

export interface PartPlan {
  /** A common part is drawn as a slim bar beneath the others. */
  bar: boolean;
  summaryLines: number;
  rows: PartRow[];
  /** Lines that exist and are not on the card. */
  more: number;
  /** For a common part: who uses it, in words. */
  usedBy: string | null;
  blocks: number;
  height: number;
}

export interface LabelSize {
  w: number;
  h: number;
  lines: number;
}

let ctx: CanvasRenderingContext2D | null | undefined;
let fontEpoch = 0;
const widths = new Map<string, number>();

/** Call when fonts finish loading: every width measured so far was of a fallback font. */
export function fontsChanged(): void {
  fontEpoch += 1;
  widths.clear();
}

function widthOf(text: string, px: number, weight: number): number {
  const key = `${fontEpoch}|${weight}|${px}|${text}`;
  const hit = widths.get(key);
  if (hit !== undefined) return hit;
  if (ctx === undefined) ctx = document.createElement('canvas').getContext('2d');
  let w = text.length * px * 0.54;
  if (ctx) {
    ctx.font = `${weight} ${px}px ${FONT}`;
    w = ctx.measureText(text).width;
  }
  widths.set(key, w);
  return w;
}

/** How many lines a text takes at a width, wrapping at spaces, up to a limit. */
export function countLines(text: string, px: number, weight: number, width: number, max: number): number {
  const room = width - SAFETY;
  const space = widthOf(' ', px, weight);
  let lines = 1;
  let x = 0;
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    const w = widthOf(word, px, weight);
    if (x > 0 && x + space + w > room) {
      lines += 1;
      x = 0;
    }
    // A word longer than the line breaks wherever it has to.
    if (w > room) {
      lines += Math.ceil(w / room) - 1;
      x = w % room;
    } else x += (x > 0 ? space : 0) + w;
    if (lines >= max) return max;
  }
  return lines;
}

const names = (items: string[], max: number): string => {
  if (items.length <= max) {
    return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
  }
  return `${items.slice(0, max - 1).join(', ')} and ${items.length - (max - 1)} more`;
};

export function planPart(deck: SimpleDeck, part: SimplePart, marks: Marks): PartPlan {
  if (part.common) {
    // Common ground is one slim bar: its name, what it is, and who rests on it.
    const others = deck.parts.length - 1;
    return {
      bar: true,
      summaryLines: part.summary ? 1 : 0,
      rows: [],
      more: 0,
      usedBy:
        part.usedBy.length >= others
          ? 'Used by every other part'
          : `Used by ${names(
              part.usedBy.map((id) => deck.partById.get(id)?.name ?? ''),
              3,
            )}`,
      blocks: part.blocks.length,
      height: BAR_H,
    };
  }
  const textW = PART_W - (PART.padX + PART.border) * 2;
  const rowW = textW - PART.marker;
  const requested = part.asked.filter((l) => marks.get(l.id)?.state === 'requested');
  const accepted = part.asked.filter((l) => marks.get(l.id)?.state !== 'requested').slice(-MAX_ASKED);
  // Requests are never folded away. What is already there gives up room to them.
  const roomFor = Math.max(1, MAX_ROWS - requested.length - accepted.length);
  const described = part.described.slice(0, Math.min(MAX_DESCRIBED, roomFor));
  const row = (line: PlainLine, kind: PartRow['kind'], isRequested: boolean, max: number): PartRow => ({
    line,
    kind,
    requested: isRequested,
    lines: countLines(line.text, TEXT_PX, 400, rowW, max),
  });
  const rows = [
    ...described.map((l) => row(l, 'described', false, 2)),
    ...accepted.map((l) => row(l, 'asked', false, 2)),
    ...requested.map((l) => row(l, 'asked', true, 3)),
  ];
  const more =
    part.described.length - described.length + (part.asked.length - requested.length - accepted.length);
  const summaryLines = part.summary ? countLines(part.summary.text, TEXT_PX, 400, textW, 3) : 0;

  let h = PART.border * 2 + PART.padTop + PART.title;
  if (summaryLines) h += PART.gapSummary + summaryLines * PART.line;
  if (rows.length || more > 0) {
    h += PART.gapRows;
    for (const r of rows) h += r.lines * PART.line + PART.gapRow;
    if (more > 0) h += PART.line;
    else h -= PART.gapRow;
  }
  h += PART.gapFoot + PART.foot + PART.padBottom;
  return {
    summaryLines,
    rows,
    bar: false,
    more,
    usedBy: null,
    blocks: part.blocks.length,
    height: Math.ceil(h / 8) * 8,
  };
}

export function labelSize(text: string): LabelSize {
  const one = widthOf(text, LABEL_PX, 550) + SAFETY;
  const lines = one <= LABEL_MAX_W ? 1 : countLines(text, LABEL_PX, 550, LABEL_MAX_W, 3);
  const w = Math.ceil((lines === 1 ? one : LABEL_MAX_W) + LABEL_PAD_X * 2);
  return { w, h: lines * LABEL_LINE + LABEL_PAD_Y * 2, lines };
}

type Point = [number, number];
type Side = 'left' | 'right' | 'top' | 'bottom';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SimpleRoute {
  points: [number, number][];
  label: Rect | null;
  /** The straight run the label sits on, when it can slide along one to keep clear of other labels. */
  run?: [[number, number], [number, number]];
}

export interface SimpleLayout {
  boxes: Map<Id, Rect>;
  routes: Map<string, SimpleRoute>;
  /** Everything drawn: the cards, the lines and their labels. */
  bounds: Rect;
}

/**
 * Everything the arrangement depends on. Two decks with the same signature are laid out alike.
 * A connection that is only asked for is not part of it: asking for one moves nothing.
 */
export function layoutSignature(
  deck: SimpleDeck,
  plans: Map<Id, PartPlan>,
  labels: Map<string, LabelSize>,
  requested: ReadonlySet<string>,
): string {
  const parts = deck.parts.map((p) => `${p.id}:${plans.get(p.id)?.height ?? 0}:${p.common ? 1 : 0}`);
  const links = deck.links
    .filter((l) => !l.hidden && !requested.has(l.id))
    .map((l) => `${l.id}:${labels.get(l.id)?.w ?? 0}x${labels.get(l.id)?.h ?? 0}`);
  return `${fontEpoch}|${parts.join(',')}|${links.join(',')}`;
}

const GAP_X = 72;
const GAP_Y = 64;
/** Between two cards stacked in one column: room for a label asked for between them. */
const STACK_GAP = 48;
/** The screen shape an arrangement is chosen for. Fixed, so a map looks the same in any window. */
const NOMINAL = { w: 1600, h: 900 };

interface Flow {
  boxes: Map<Id, Rect>;
  routes: Map<string, SimpleRoute>;
  width: number;
  height: number;
}

async function flow(
  direction: 'DOWN' | 'RIGHT',
  parts: SimplePart[],
  links: SimpleLink[],
  plans: Map<Id, PartPlan>,
  labels: Map<string, LabelSize>,
): Promise<Flow> {
  const boxes = new Map<Id, Rect>();
  const routes = new Map<string, SimpleRoute>();
  if (parts.length === 0) return { boxes, routes, width: 0, height: 0 };
  const edges: ElkExtendedEdge[] = links.map((l) => {
    const size = labels.get(l.id);
    return {
      id: l.id,
      sources: [l.from],
      targets: [l.to],
      labels: size
        ? [
            {
              id: `${l.id}:label`,
              text: l.label.text,
              width: size.w,
              height: size.h,
              layoutOptions: { 'elk.edgeLabels.inline': 'true' },
            },
          ]
        : [],
    };
  });
  const down = direction === 'DOWN';
  const graph: ElkNode = {
    id: 'simple',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.padding': '[top=0,left=0,bottom=0,right=0]',
      'elk.spacing.nodeNode': String(down ? GAP_X : STACK_GAP),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(down ? GAP_Y : 44),
      'elk.spacing.edgeNode': '32',
      'elk.layered.spacing.edgeNodeBetweenLayers': '26',
      'elk.spacing.edgeEdge': '24',
      'elk.spacing.portPort': String(END_CLEAR),
      'elk.layered.spacing.edgeEdgeBetweenLayers': '20',
      'elk.spacing.edgeLabel': '6',
      'elk.spacing.componentComponent': String(GAP_X),
      'elk.separateConnectedComponents': 'true',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.mergeEdges': 'false',
      'elk.aspectRatio': '1.7',
    },
    children: parts.map((p) => ({ id: p.id, width: PART_W, height: plans.get(p.id)?.height ?? 200 })),
    edges,
  };
  const out = await simpleEngine().layout(graph);
  let width = 0;
  let height = 0;
  for (const node of out.children ?? []) {
    const box = { x: node.x ?? 0, y: node.y ?? 0, w: node.width ?? PART_W, h: node.height ?? 200 };
    boxes.set(node.id, box);
    width = Math.max(width, box.x + box.w);
    height = Math.max(height, box.y + box.h);
  }
  for (const edge of (out.edges ?? []) as ElkExtendedEdge[]) {
    const section = edge.sections?.[0];
    if (!section) continue;
    const points: [number, number][] = [
      [section.startPoint.x, section.startPoint.y],
      ...(section.bendPoints ?? []).map((p): [number, number] => [p.x, p.y]),
      [section.endPoint.x, section.endPoint.y],
    ];
    const label = edge.labels?.[0];
    routes.set(edge.id, {
      points,
      label:
        label && label.x !== undefined && label.y !== undefined
          ? { x: label.x, y: label.y, w: label.width ?? 0, h: label.height ?? 0 }
          : null,
    });
    for (const [x, y] of points) {
      width = Math.max(width, x);
      height = Math.max(height, y);
    }
    if (label?.x !== undefined) width = Math.max(width, label.x + (label.width ?? 0));
    if (label?.y !== undefined) height = Math.max(height, label.y + (label.height ?? 0));
  }
  return { boxes, routes, width, height };
}

/** Rows of cards in reading order, callers before what they call, with each line taking the plainest clear path. */
function shelf(
  parts: SimplePart[],
  links: SimpleLink[],
  plans: Map<Id, PartPlan>,
  labels: Map<string, LabelSize>,
  bars: number,
): Flow {
  const boxes = new Map<Id, Rect>();
  const routes = new Map<string, SimpleRoute>();
  if (parts.length === 0) return { boxes, routes, width: 0, height: 0 };
  // How far each part is from a part nothing calls. A cycle is cut where it is first met.
  const out = new Map<Id, Id[]>();
  for (const l of links) out.set(l.from, [...(out.get(l.from) ?? []), l.to]);
  const depth = new Map<Id, number>();
  const visiting = new Set<Id>();
  const visit = (id: Id): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let below = 0;
    for (const to of out.get(id) ?? []) below = Math.max(below, visit(to) + 1);
    visiting.delete(id);
    depth.set(id, below);
    return below;
  };
  for (const p of parts) visit(p.id);
  // The deepest callers come first: depth here counts down to the parts that call nothing.
  const order = parts
    .map((p, i) => ({ p, i, d: depth.get(p.id) ?? 0 }))
    .sort((a, b) => b.d - a.d || a.i - b.i)
    .map((x) => x.p);

  const gapX = LABEL_MAX_W + LABEL_PAD_X * 2 + 52;
  const gapY = 104;
  const heightOf = (p: SimplePart) => plans.get(p.id)?.height ?? 200;
  let best: { cols: number; score: number } = { cols: 1, score: 0 };
  for (let cols = 1; cols <= order.length; cols++) {
    const w = cols * PART_W + (cols - 1) * gapX;
    let h = 0;
    for (let i = 0; i < order.length; i += cols)
      h += Math.max(...order.slice(i, i + cols).map(heightOf)) + (i > 0 ? gapY : 0);
    const score = Math.min(NOMINAL.w / w, NOMINAL.h / (h + bars));
    if (score > best.score) best = { cols, score };
  }
  let y = 0;
  let width = 0;
  for (let i = 0; i < order.length; i += best.cols) {
    const row = order.slice(i, i + best.cols);
    let x = 0;
    for (const p of row) {
      boxes.set(p.id, { x, y, w: PART_W, h: heightOf(p) });
      x += PART_W + gapX;
    }
    width = Math.max(width, x - gapX);
    y += Math.max(...row.map(heightOf)) + gapY;
  }
  const height = y - gapY;
  const ends: Point[] = [];
  for (const link of links) {
    const a = boxes.get(link.from);
    const b = boxes.get(link.to);
    if (!a || !b) continue;
    const others: Rect[] = [];
    for (const [id, box] of boxes) if (id !== link.from && id !== link.to) others.push(box);
    const route = detour(a, b, others, labels.get(link.id), ends, []);
    routes.set(link.id, route);
    ends.push(route.points[0]!, route.points.at(-1)!);
  }
  settleLabels(routes.values(), [...boxes.values()], []);
  for (const r of routes.values()) {
    for (const [px, py] of r.points) {
      width = Math.max(width, px);
      y = Math.max(y, py + gapY);
    }
    if (r.label) width = Math.max(width, r.label.x + r.label.w);
  }
  return { boxes, routes, width, height: Math.max(height, y - gapY) };
}

/**
 * The arrangement of everything that is built: where each part sits and how each connection
 * runs. Connections that are only asked for are added afterwards by `withRequests`.
 */
export async function layoutSimple(
  deck: SimpleDeck,
  plans: Map<Id, PartPlan>,
  labels: Map<string, LabelSize>,
  requested: ReadonlySet<string>,
): Promise<SimpleLayout> {
  const flowing = deck.parts.filter((p) => !p.common);
  const common = deck.parts.filter((p) => p.common);
  const inFlow = new Set(flowing.map((p) => p.id));
  const routed = deck.links.filter(
    (l) => !l.hidden && !requested.has(l.id) && inFlow.has(l.from) && inFlow.has(l.to),
  );

  // Callers above what they call, as in the advanced view, unless reading left to right
  // lets the whole picture be clearly larger on a wide screen.
  const bars = common.length * (BAR_H + 16) + (common.length ? 16 : 0);
  const [down, right] = await Promise.all([
    flow('DOWN', flowing, routed, plans, labels),
    flow('RIGHT', flowing, routed, plans, labels),
  ]);
  const fit = (f: Flow) =>
    Math.min(NOMINAL.w / Math.max(1, f.width), NOMINAL.h / Math.max(1, f.height + bars));
  const layered = fit(right) > fit(down) * 1.08 ? right : down;
  // Layers suit a system that fans out. A long chain of parts, or a great many of them,
  // would be screens long in layers: those are set out in rows instead, callers first,
  // so the cards stay large enough to read.
  const rows = shelf(flowing, routed, plans, labels, bars);
  const best = fit(rows) > fit(layered) * 1.25 ? rows : layered;
  const { boxes, routes, width, height } = best;

  // Common ground lies beneath everything that rests on it, as wide as the picture.
  let y = flowing.length ? Math.ceil((height + 32) / 8) * 8 : 0;
  for (const p of common) {
    boxes.set(p.id, { x: 0, y, w: Math.max(width, PART_W * 2), h: BAR_H });
    y += BAR_H + 16;
  }
  return { boxes, routes, bounds: boundsOf(boxes, routes) };
}

/**
 * Add the connections that are asked for and not built, and the few that start at a common
 * part. Each takes the plainest path between its two cards that crosses no other card.
 * Nothing that was already placed moves.
 */
export function withRequests(
  base: SimpleLayout,
  deck: SimpleDeck,
  labels: Map<string, LabelSize>,
): SimpleLayout {
  const routes = new Map<string, SimpleRoute>();
  const added: SimpleRoute[] = [];
  // What was there first does not move: a new line keeps its ends clear of the ends already
  // on a card, and runs behind no label when another way is open.
  const there = [...base.routes.values()].map((r) => r.label).filter((l): l is Rect => l !== null);
  const ends: Point[] = [];
  for (const r of base.routes.values()) ends.push(r.points[0]!, r.points.at(-1)!);
  for (const link of deck.links) {
    if (link.hidden) continue;
    const have = base.routes.get(link.id);
    if (have) {
      routes.set(link.id, have);
      continue;
    }
    const a = base.boxes.get(link.from);
    const b = base.boxes.get(link.to);
    if (!a || !b) continue;
    const others: Rect[] = [];
    for (const [id, box] of base.boxes) if (id !== link.from && id !== link.to) others.push(box);
    const route = detour(a, b, others, labels.get(link.id), ends, there);
    routes.set(link.id, route);
    added.push(route);
    ends.push(route.points[0]!, route.points.at(-1)!);
  }
  // A new label keeps clear of the ones that were there first.
  settleLabels(added, [...base.boxes.values()], there);
  return { boxes: base.boxes, routes, bounds: boundsOf(base.boxes, routes) };
}

function boundsOf(boxes: Map<Id, Rect>, routes: Map<string, SimpleRoute>): Rect {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  const take = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const b of boxes.values()) {
    take(b.x, b.y);
    take(b.x + b.w, b.y + b.h);
  }
  for (const r of routes.values()) {
    for (const [x, y] of r.points) take(x, y);
    if (r.label) {
      take(r.label.x, r.label.y);
      take(r.label.x + r.label.w, r.label.y + r.label.h);
    }
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function crosses(p: Point, q: Point, r: Rect, pad: number): boolean {
  return (
    Math.min(p[0], q[0]) < r.x + r.w + pad &&
    Math.max(p[0], q[0]) > r.x - pad &&
    Math.min(p[1], q[1]) < r.y + r.h + pad &&
    Math.max(p[1], q[1]) > r.y - pad
  );
}

/**
 * A path from one card to another that stays clear of the others: straight across when it
 * can, around the outside when it must. Each end carries a round mark, so an end takes a
 * place on its side that no other line's end has taken.
 */
function detour(
  a: Rect,
  b: Rect,
  others: Rect[],
  size: LabelSize | undefined,
  ends: Point[],
  labels: Rect[],
): SimpleRoute {
  const acx = a.x + a.w / 2;
  const acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2;
  const bcy = b.y + b.h / 2;
  /** The free place nearest to `want` along one side of a card, never at a corner. */
  const place = (r: Rect, side: Side, want: number): Point => {
    const upright = side === 'left' || side === 'right';
    const fixed = side === 'left' ? r.x : side === 'right' ? r.x + r.w : side === 'top' ? r.y : r.y + r.h;
    const lo = (upright ? r.y : r.x) + END_CLEAR;
    const hi = Math.max(lo, (upright ? r.y + r.h : r.x + r.w) - END_CLEAR);
    const taken = ends
      .filter((e) => Math.abs((upright ? e[0] : e[1]) - fixed) < 1)
      .map((e) => (upright ? e[1] : e[0]))
      .filter((v) => v > lo - END_CLEAR && v < hi + END_CLEAR);
    const free = (v: number) => taken.every((t) => Math.abs(t - v) >= END_CLEAR - 0.5);
    const first = Math.min(Math.max(want, lo), hi);
    let v = first;
    if (!free(first)) {
      const spots = taken
        .flatMap((t) => [t - END_CLEAR, t + END_CLEAR])
        .filter((c) => c >= lo && c <= hi && free(c))
        .sort((p, q) => Math.abs(p - first) - Math.abs(q - first));
      v = spots[0] ?? first;
    }
    return upright ? [fixed, v] : [v, fixed];
  };
  const right = b.x - (a.x + a.w);
  const left = a.x - (b.x + b.w);
  const below = b.y - (a.y + a.h);
  const above = a.y - (b.y + b.h);
  const span = [a, b, ...others];
  const rows = span.filter((r) => r.y < Math.max(a.y + a.h, b.y + b.h) && r.y + r.h > Math.min(a.y, b.y));
  const cols = span.filter((r) => r.x < Math.max(a.x + a.w, b.x + b.w) && r.x + r.w > Math.min(a.x, b.x));
  const out = 36;
  const farRight = Math.max(...rows.map((r) => r.x + r.w)) + out;
  const farLeft = Math.min(...rows.map((r) => r.x)) - out;
  const farBelow = Math.max(...cols.map((r) => r.y + r.h)) + out;
  const farAbove = Math.min(...cols.map((r) => r.y)) - out;

  const tries: { points: Point[]; side?: 'right' | 'left'; across?: boolean }[] = [];
  const z = (p: Point[]) => p.filter((pt, i) => i === 0 || pt[0] !== p[i - 1]![0] || pt[1] !== p[i - 1]![1]);
  /** Out of one side, across the gap, into the facing side. */
  const across = (from: Point, to: Point, mid: number, upright: boolean) =>
    tries.push({
      points: z(
        upright ? [from, [mid, from[1]], [mid, to[1]], to] : [from, [from[0], mid], [to[0], mid], to],
      ),
      across: true,
    });
  if (right >= 24) across(place(a, 'right', bcy), place(b, 'left', acy), a.x + a.w + right / 2, true);
  if (left >= 24) across(place(a, 'left', bcy), place(b, 'right', acy), b.x + b.w + left / 2, true);
  // Between two cards stacked close, the label cannot sit clear of both. The line then runs
  // near their right-hand ends, away from the flags that hang on a card's top left corner.
  const tight = (gap: number) => size !== undefined && gap < size.h + 24;
  const aside = Math.min(a.x + a.w, b.x + b.w) + 16 - (size?.w ?? 0) / 2;
  if (below >= 24) {
    const want = tight(below) ? [aside, aside] : [bcx, acx];
    across(place(a, 'bottom', want[0]!), place(b, 'top', want[1]!), a.y + a.h + below / 2, false);
  }
  if (above >= 24) {
    const want = tight(above) ? [aside, aside] : [bcx, acx];
    across(place(a, 'top', want[0]!), place(b, 'bottom', want[1]!), b.y + b.h + above / 2, false);
  }
  /** Out of a side, around the outside, into the same side of the other card. */
  const around = (side: Side, far: number) => {
    const upright = side === 'left' || side === 'right';
    const from = place(a, side, upright ? acy : acx);
    const to = place(b, side, upright ? bcy : bcx);
    tries.push({
      points: upright ? [from, [far, from[1]], [far, to[1]], to] : [from, [from[0], far], [to[0], far], to],
      ...(side === 'left' || side === 'right' ? { side } : {}),
    });
  };
  around('right', farRight);
  around('left', farLeft);
  around('bottom', farBelow);
  around('top', farAbove);

  const free = (points: Point[], behind: Rect[]) =>
    points.every(
      (p, i) =>
        i === 0 ||
        (others.every((r) => !crosses(points[i - 1]!, p, r, 10)) &&
          behind.every((r) => !crosses(points[i - 1]!, p, r, 4))),
    );
  // Clear of every card and of every label. Failing that, clear of every card.
  const pick =
    tries.find((t) => free(t.points, labels)) ?? tries.find((t) => free(t.points, [])) ?? tries[0]!;
  if (!size) return { points: pick.points, label: null };

  // The label sits on the longest run. Beside it, on the far side, when the line goes around.
  let best = 1;
  let bestLen = -1;
  for (let i = 1; i < pick.points.length; i++) {
    const len = Math.hypot(
      pick.points[i]![0] - pick.points[i - 1]![0],
      pick.points[i]![1] - pick.points[i - 1]![1],
    );
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  }
  // Across a gap, the label goes in the middle of the gap: on the run that crosses it, or
  // halfway along a line that goes straight over.
  const straight = pick.across === true && pick.points.length < 4;
  if (pick.across) best = 2;
  const p = straight ? pick.points[0]! : pick.points[best - 1]!;
  const q = straight ? pick.points.at(-1)! : pick.points[Math.min(best, pick.points.length - 1)]!;
  const cx = (p[0] + q[0]) / 2;
  const cy = (p[1] + q[1]) / 2;
  const x = pick.side === 'right' ? cx + 8 : pick.side === 'left' ? cx - 8 - size.w : cx - size.w / 2;
  return {
    points: pick.points,
    label: { x, y: cy - size.h / 2, w: size.w, h: size.h },
    ...(pick.side ? {} : { run: [p, q] }),
  };
}

const meet = (a: Rect, b: Rect, pad: number) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/**
 * Slide each label along its own run until it is clear of the cards and of the labels placed
 * before it. The labels with the least room to move are placed first, so the ones that can
 * give way are the ones that do.
 */
function settleLabels(routes: Iterable<SimpleRoute>, cards: Rect[], taken: Rect[]): void {
  const room = (route: SimpleRoute): number => {
    if (!route.run || !route.label) return 0;
    const [p, q] = route.run;
    const along = p[1] === q[1] ? route.label.w : route.label.h;
    return Math.max(0, Math.hypot(q[0] - p[0], q[1] - p[1]) - along);
  };
  const order = [...routes].map((route, i) => ({ route, i, room: room(route) }));
  order.sort((a, b) => a.room - b.room || a.i - b.i);
  for (const { route } of order) {
    const label = route.label;
    if (!label) continue;
    const run = route.run;
    if (run) {
      const [p, q] = run;
      for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.12, 0.88]) {
        const spot = {
          x: p[0] + (q[0] - p[0]) * t - label.w / 2,
          y: p[1] + (q[1] - p[1]) * t - label.h / 2,
          w: label.w,
          h: label.h,
        };
        if (taken.some((r) => meet(spot, r, 4)) || cards.some((r) => meet(spot, r, 2))) continue;
        label.x = spot.x;
        label.y = spot.y;
        break;
      }
    }
    taken.push(label);
  }
}

export function linkRequested(link: SimpleLink, marks: Marks): 'all' | 'some' | 'none' {
  if (marks.size === 0) return 'none';
  let n = 0;
  for (const e of link.edges) if (marks.get(e.id)?.state === 'requested') n += 1;
  return n === 0 ? 'none' : n === link.edges.length ? 'all' : 'some';
}

/** What fits on a card when its text is drawn larger to stay readable from further away. */
export function fitPart(
  part: SimplePart,
  plan: PartPlan,
  scale: number,
): { summaryLines: number; rows: PartRow[]; more: number } {
  const textW = PART_W - (PART.padX + PART.border) * 2;
  const line = PART.line * scale;
  let room = plan.height - PART.border * 2 - PART.padTop - PART.padBottom - PART.title * scale;
  let summaryLines = 0;
  if (part.summary) {
    const need = countLines(part.summary.text, TEXT_PX * scale, 400, textW, 6);
    summaryLines = Math.max(0, Math.min(need, Math.floor((room - PART.gapSummary * scale) / line)));
    if (summaryLines) room -= PART.gapSummary * scale + summaryLines * line;
  }
  const total = plan.rows.length + plan.more;
  room -= PART.gapRows * scale;
  const sized = plan.rows.map((row) => ({
    ...row,
    lines: countLines(row.line.text, TEXT_PX * scale, 400, textW - PART.marker * scale, 2),
  }));
  // What was asked for is kept before anything else: it is what someone is waiting on.
  const keep = new Set<PartRow>();
  for (const pass of [true, false]) {
    for (const row of sized) {
      if (row.requested !== pass) continue;
      // Keep a line for "+N more" unless this is the last thing there is to show.
      const left = total - keep.size - 1;
      const need = row.lines * line + (left > 0 ? line : 0);
      if (need > room) break;
      keep.add(row);
      room -= row.lines * line + PART.gapRow * scale;
    }
  }
  const rows = sized.filter((row) => keep.has(row));
  return { summaryLines, rows, more: total - rows.length };
}
