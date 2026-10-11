// Layout (spec §3.11). ELK produces the first arrangement; after that, positions are data.
// Expanding a card only pushes what sits directly beneath it, and everything returns on collapse.
import type { DeckIndex, DeckNode, Id, Point } from '@decker/deck-model';
import ELK, { type ElkExtendedEdge, type ElkNode } from 'elkjs/lib/elk-api';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';
import { BLOCK_W } from './measure';

export interface Box {
  id: Id;
  kind: 'area' | 'block';
  parent: Id | null;
  depth: number;
  x: number; // relative to the parent's top-left corner
  y: number;
  w: number;
  h: number;
  ax: number; // absolute
  ay: number;
}

export type Display = Map<Id, Box>;
export type Positions = Record<Id, Point>;

export const AREA = { top: 60, side: 24, bottom: 24, ext: 30, minW: BLOCK_W + 48, minH: 132 };

const placeable = (n: DeckNode) => n.kind === 'area' || n.kind === 'block';

export function kidsOf(index: DeckIndex, parentId: Id): DeckNode[] {
  return (index.children.get(parentId) ?? []).filter(placeable);
}

/** Packages and services used by blocks directly inside an area, docked on its edge. */
export function areaExternals(index: DeckIndex, areaId: Id): DeckNode[] {
  const out: DeckNode[] = [];
  for (const kid of index.children.get(areaId) ?? []) {
    if (kid.kind !== 'block') continue;
    for (const ext of index.externalsOf.get(kid.id) ?? []) if (!out.includes(ext)) out.push(ext);
  }
  return out;
}

interface Item {
  node: DeckNode;
  x: number;
  y: number;
  w: number;
  h: number;
  bh: number; // height at rest
  yy: number; // displayed y
}

/**
 * Turn stored positions and current sizes into what is drawn.
 * `height` is a block's current height, `rest` its collapsed height.
 */
export function computeDisplay(
  index: DeckIndex,
  positions: Positions,
  height: (id: Id) => number,
  rest: (id: Id) => number,
): Display {
  const display: Display = new Map();

  const layout = (parentId: Id, depth: number): { w: number; h: number; bh: number } => {
    const items: Item[] = [];
    for (const node of kidsOf(index, parentId)) {
      const p = positions[node.id];
      if (!p) continue;
      if (node.kind === 'area') {
        const size = layout(node.id, depth + 1);
        items.push({ node, x: p.x, y: p.y, w: size.w, h: size.h, bh: size.bh, yy: p.y });
      } else {
        items.push({ node, x: p.x, y: p.y, w: BLOCK_W, h: height(node.id), bh: rest(node.id), yy: p.y });
      }
    }
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    let w = 0;
    let h = 0;
    let bh = 0;
    for (let i = 0; i < items.length; i++) {
      const b = items[i]!;
      for (let j = 0; j < i; j++) {
        const a = items[j]!;
        if (a.h === a.bh && a.yy === a.y) continue; // nothing grew or moved above
        if (a.y + a.bh <= b.y + 1 && a.x < b.x + b.w && b.x < a.x + a.w) {
          b.yy = Math.max(b.yy, a.yy + a.h + (b.y - (a.y + a.bh)));
        }
      }
      w = Math.max(w, b.x + b.w);
      h = Math.max(h, b.yy + b.h);
      bh = Math.max(bh, b.y + b.bh);
      display.set(b.node.id, {
        id: b.node.id,
        kind: b.node.kind as 'area' | 'block',
        parent: parentId === index.system.id ? null : parentId,
        depth,
        x: b.x,
        y: b.yy,
        w: b.w,
        h: b.h,
        ax: 0,
        ay: 0,
      });
    }
    if (parentId === index.system.id) return { w, h, bh };
    const foot = AREA.bottom + (areaExternals(index, parentId).length ? AREA.ext : 0);
    if (items.length === 0) return { w: AREA.minW, h: AREA.minH, bh: AREA.minH };
    return { w: Math.max(AREA.minW, w + AREA.side), h: h + foot, bh: bh + foot };
  };
  layout(index.system.id, 0);

  const absolute = (parentId: Id, ox: number, oy: number) => {
    for (const node of kidsOf(index, parentId)) {
      const box = display.get(node.id);
      if (!box) continue;
      box.ax = ox + box.x;
      box.ay = oy + box.y;
      if (node.kind === 'area') absolute(node.id, box.ax, box.ay);
    }
  };
  absolute(index.system.id, 0, 0);
  return display;
}

export function boundsOf(
  display: Display,
  ids?: Iterable<Id>,
): { x: number; y: number; width: number; height: number } | null {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  const boxes = ids
    ? [...ids].map((id) => display.get(id)).filter((b): b is Box => Boolean(b))
    : [...display.values()].filter((b) => b.depth === 0);
  for (const b of boxes) {
    x0 = Math.min(x0, b.ax);
    y0 = Math.min(y0, b.ay);
    x1 = Math.max(x1, b.ax + b.w);
    y1 = Math.max(y1, b.ay + b.h);
  }
  if (!Number.isFinite(x0)) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// ---- Automatic layout with ELK, off the main thread ----

let elk: InstanceType<typeof ELK> | null = null;

function buildElkGraph(index: DeckIndex, rest: (id: Id) => number): ElkNode {
  // Every arrow is laid out at the level where its two ends first share a parent.
  const chain = (id: Id): Id[] => {
    const out: Id[] = [];
    let cur = index.byId.get(id);
    while (cur) {
      out.unshift(cur.id);
      cur = cur.parentId ? index.byId.get(cur.parentId) : undefined;
    }
    return out;
  };
  const edgesAt = new Map<Id, Map<string, ElkExtendedEdge>>();
  for (const link of index.links) {
    const a = chain(link.from);
    const b = chain(link.to);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
    if (i === 0 || i >= a.length || i >= b.length) continue;
    const parent = a[i - 1]!;
    const key = `${a[i]}>${b[i]}`;
    let bucket = edgesAt.get(parent);
    if (!bucket) {
      bucket = new Map();
      edgesAt.set(parent, bucket);
    }
    if (!bucket.has(key) && !bucket.has(`${b[i]}>${a[i]}`))
      bucket.set(key, { id: `e:${parent}:${key}`, sources: [a[i]!], targets: [b[i]!] });
  }

  const build = (node: DeckNode, depth: number): ElkNode => {
    if (node.kind === 'block') return { id: node.id, width: BLOCK_W, height: rest(node.id) };
    const kids = kidsOf(index, node.id);
    const edges = [...(edgesAt.get(node.id)?.values() ?? [])];
    const isRoot = node.kind === 'system';
    const foot = AREA.bottom + (isRoot ? 0 : areaExternals(index, node.id).length ? AREA.ext : 0);
    const padding = isRoot
      ? '[top=0,left=0,bottom=0,right=0]'
      : `[top=${AREA.top},left=${AREA.side},bottom=${foot},right=${AREA.side}]`;
    const gap = isRoot ? 56 : depth === 1 && kids.some((k) => k.kind === 'area') ? 32 : 24;
    const common = {
      'elk.padding': padding,
      'elk.spacing.nodeNode': String(gap),
      'elk.spacing.componentComponent': String(gap),
      'elk.aspectRatio': isRoot ? '1.7' : '1.5',
    };
    const options: Record<string, string> =
      edges.length === 0
        ? {
            ...common,
            'elk.algorithm': 'rectpacking',
            'elk.rectpacking.widthApproximation.optimizationGoal': 'ASPECT_RATIO_DRIVEN',
            'elk.contentAlignment': 'V_TOP H_LEFT',
          }
        : {
            ...common,
            'elk.algorithm': 'layered',
            'elk.direction': 'DOWN',
            'elk.layered.spacing.nodeNodeBetweenLayers': String(isRoot ? 72 : 44),
            'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
            'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
            'elk.layered.crossingMinimization.semiInteractive': 'false',
            'elk.separateConnectedComponents': 'true',
            'elk.edgeRouting': 'POLYLINE',
            // A long chain of areas would make a map many screens tall: wrap it into columns.
            ...(isRoot && kids.length > 10
              ? {
                  'elk.layered.wrapping.strategy': 'MULTI_EDGE',
                  'elk.layered.wrapping.additionalEdgeSpacing': '48',
                }
              : {}),
          };
    return { id: node.id, layoutOptions: options, children: kids.map((k) => build(k, depth + 1)), edges };
  };
  return build(index.system, 0);
}

/** A full automatic layout. Runs in a worker and never blocks the canvas. */
export async function autoLayout(index: DeckIndex, rest: (id: Id) => number): Promise<Positions> {
  elk ??= new ELK({ workerUrl: elkWorkerUrl });
  const result = await elk.layout(buildElkGraph(index, rest));
  const positions: Positions = {};
  const snap = (v: number) => Math.round(v / 8) * 8;
  const read = (node: ElkNode, isRoot: boolean) => {
    if (!isRoot) positions[node.id] = { x: snap(node.x ?? 0), y: snap(node.y ?? 0) };
    for (const child of node.children ?? []) read(child, false);
  };
  read(result, true);
  flowRoot(result.children ?? [], positions);
  return positions;
}

/**
 * Arrange the top-level areas in reading order: ELK decides who comes before whom
 * (callers first), and the rows are then filled to suit a wide screen. A strictly layered
 * top level would be many screens tall for no gain in meaning.
 */
function flowRoot(items: ElkNode[], positions: Positions): void {
  if (items.length < 2) return;
  const gapX = 56;
  const gapY = 72;
  const ordered = [...items].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
  const area = ordered.reduce((sum, n) => sum + (n.width ?? 0) * (n.height ?? 0), 0);
  const widest = Math.max(...ordered.map((n) => n.width ?? 0));
  const target = Math.max(widest, Math.sqrt(area * 1.75) * 1.12);
  const rows: ElkNode[][] = [];
  let row: ElkNode[] = [];
  let width = 0;
  for (const n of ordered) {
    const w = n.width ?? 0;
    if (row.length && width + gapX + w > target) {
      rows.push(row);
      row = [];
      width = 0;
    }
    width += (row.length ? gapX : 0) + w;
    row.push(n);
  }
  if (row.length) rows.push(row);
  const rowWidth = (r: ElkNode[]) => r.reduce((sum, n) => sum + (n.width ?? 0), 0) + gapX * (r.length - 1);
  const full = Math.max(...rows.map(rowWidth));
  let y = 0;
  for (const r of rows) {
    let x = Math.round((full - rowWidth(r)) / 2 / 8) * 8;
    for (const n of r) {
      positions[n.id] = { x, y };
      x += (n.width ?? 0) + gapX;
    }
    y += Math.max(...r.map((n) => n.height ?? 0)) + gapY;
  }
}

/** How many areas and blocks have no stored position yet. */
export function countMissing(index: DeckIndex, positions: Positions): { missing: number; total: number } {
  let missing = 0;
  let total = 0;
  for (const n of index.snapshot.nodes) {
    if (!placeable(n)) continue;
    total += 1;
    if (!positions[n.id]) missing += 1;
  }
  return { missing, total };
}

/**
 * Place only what is new, inside its area and near its callers. Existing positions never move.
 */
export function placeMissing(
  index: DeckIndex,
  positions: Positions,
  rest: (id: Id) => number,
  hints: Positions = {},
): Positions {
  const next: Positions = { ...positions };
  const visit = (parentId: Id) => {
    const kids = kidsOf(index, parentId);
    for (const kid of kids) if (kid.kind === 'area') visit(kid.id);
    const missing = kids.filter((k) => !next[k.id]);
    if (missing.length === 0) return;
    for (const kid of missing) {
      const hint = hints[kid.id];
      if (hint) {
        next[kid.id] = { x: Math.max(AREA.side, hint.x), y: Math.max(AREA.top, hint.y) };
        continue;
      }
      // Measure the newcomer by placing it far away, then find it a free spot.
      next[kid.id] = { x: 1e6, y: 1e6 };
      const display = computeDisplay(index, next, rest, rest);
      const me = display.get(kid.id)!;
      const others = kids
        .filter((k) => k.id !== kid.id && next[k.id] && next[k.id]!.x < 1e6)
        .map((k) => display.get(k.id)!);
      const originX = parentId === index.system.id ? 0 : AREA.side;
      const originY = parentId === index.system.id ? 0 : AREA.top;
      const gap = kid.kind === 'area' ? 48 : 24;
      let near: Box | undefined;
      if (kid.kind === 'block') {
        for (const link of index.linksIn.get(kid.id) ?? []) {
          near = others.find((o) => o.id === link.from);
          if (near) break;
        }
      }
      const free = (x: number, y: number) =>
        others.every(
          (o) =>
            x + me.w + gap <= o.x || o.x + o.w + gap <= x || y + me.h + gap <= o.y || o.y + o.h + gap <= y,
        );
      const maxX = Math.max(originX, ...others.map((o) => o.x + o.w));
      const maxY = Math.max(originY, ...others.map((o) => o.y + o.h));
      let best: Point | null = null;
      let bestScore = Number.POSITIVE_INFINITY;
      const tx = near ? near.x : originX;
      const ty = near ? near.y + near.h + 40 : originY;
      for (let y = originY; y <= maxY + gap; y += 16) {
        for (let x = originX; x <= maxX; x += 16) {
          if (!free(x, y)) continue;
          const score = Math.abs(x - tx) + Math.abs(y - ty) * 1.5;
          if (score < bestScore) {
            bestScore = score;
            best = { x, y };
          }
        }
      }
      next[kid.id] = best ?? { x: originX, y: others.length ? maxY + gap + 16 : originY };
    }
  };
  visit(index.system.id);
  return next;
}
