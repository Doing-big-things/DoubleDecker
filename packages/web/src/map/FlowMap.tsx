// The React Flow implementation of the map. Everything outside this folder talks to it
// through the store and the camera, so the renderer can be replaced (spec §8.2).
import type { DeckIndex, Id } from '@decker/deck-model';
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  type Edge,
  MiniMap,
  type Node,
  type NodeChange,
  type NodeHandle,
  type OnConnectEnd,
  Position,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  applyNodeChanges,
  useConnection,
  useReactFlow,
} from '@xyflow/react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AREA, type Box, type Display, computeDisplay } from '../model/layout';
import { BLOCK_W, blockHeight, collapsedHeight } from '../model/measure';
import { currentRun, useDeck, useLevel } from '../state/store';
import { AreaNode, AreaTitles, ChipContext, areaStyle } from './AreaNode';
import { BlockNode } from './BlockNode';
import { LinkEdge } from './LinkEdge';
import { BANDS, MAX_ZOOM, MIN_ZOOM, bandFor, bandVars, camera, levelOf } from './camera';
import { type Side, sideOf, slot } from './geometry';

const nodeTypes = { area: AreaNode, block: BlockNode };
const edgeTypes = { link: LinkEdge };
const LEVEL_NAME = { system: 'System', architecture: 'Architecture', blocks: 'Blocks' } as const;

const restCache = new WeakMap<DeckIndex, Map<Id, number>>();
function restHeights(index: DeckIndex): Map<Id, number> {
  let map = restCache.get(index);
  if (!map) {
    map = new Map(index.blocks.map((b) => [b.id, collapsedHeight(index, b.id)]));
    restCache.set(index, map);
  }
  return map;
}

function handlesFor(w: number, h: number, block: boolean): NodeHandle[] {
  const anchors: NodeHandle[] = [
    { id: 'cs', type: 'source', position: Position.Bottom, x: w / 2, y: h / 2, width: 1, height: 1 },
    { id: 'ct', type: 'target', position: Position.Top, x: w / 2, y: h / 2, width: 1, height: 1 },
  ];
  if (block) {
    // Declared up front so nothing has to be measured, including the ports a connection starts from.
    anchors.push(
      { id: 'in', type: 'target', position: Position.Top, x: 0, y: 0, width: w, height: h },
      { id: 'pt', type: 'source', position: Position.Top, x: w / 2 - 5, y: -5, width: 10, height: 10 },
      { id: 'pb', type: 'source', position: Position.Bottom, x: w / 2 - 5, y: h - 5, width: 10, height: 10 },
      { id: 'pl', type: 'source', position: Position.Left, x: -5, y: h / 2 - 5, width: 10, height: 10 },
      { id: 'pr', type: 'source', position: Position.Right, x: w - 5, y: h / 2 - 5, width: 10, height: 10 },
    );
  }
  return anchors;
}

function makeNode(box: Box, x: number, y: number, w: number, h: number): Node {
  const block = box.kind === 'block';
  return {
    id: box.id,
    type: box.kind,
    position: { x, y },
    parentId: box.parent ?? undefined,
    width: w,
    height: h,
    draggable: block,
    selectable: false,
    focusable: false,
    zIndex: block ? 10 : box.depth,
    data: {},
    handles: handlesFor(w, h, block),
  };
}

const roundRect = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r},${y}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${-(w - 2 * r)}a${r},${r} 0 0 1 ${-r},${-r}v${-(h - 2 * r)}a${r},${r} 0 0 1 ${r},${-r}z`;

function Canvas() {
  const index = useDeck((s) => s.index);
  const positions = useDeck((s) => s.positions);
  const expanded = useDeck((s) => s.expanded);
  const internals = useDeck((s) => s.internals);
  const testsToggled = useDeck((s) => s.testsToggled);
  const allTests = useDeck((s) => s.allTests);
  const run = useDeck(currentRun);
  const band = useDeck((s) => s.band);
  const laying = useDeck((s) => s.laying);
  const layoutEpoch = useDeck((s) => s.layoutEpoch);
  const status = useDeck((s) => s.status);
  const level = useLevel();
  const rf = useReactFlow();
  const connecting = useConnection((c) => c.inProgress);
  const wrap = useRef<HTMLDivElement>(null);
  const [panOnScroll, setPanOnScroll] = useState(false);
  const [zoomPct, setZoomPct] = useState(100);

  const display: Display = useMemo(() => {
    if (!index) return new Map();
    const rest = restHeights(index);
    const st = { expanded, internals, testsOpen: (id: Id) => allTests !== testsToggled.has(id), run };
    const grown = expanded.size > 0 || allTests || testsToggled.size > 0;
    const height = (id: Id) => (grown && (expanded.has(id) || st.testsOpen(id)) ? blockHeight(index, id, st) : (rest.get(id) ?? 100));
    return computeDisplay(index, positions, height, (id) => rest.get(id) ?? 100);
  }, [index, positions, expanded, internals, testsToggled, allTests, run]);

  useEffect(() => {
    camera.setDisplay(display);
  }, [display]);

  // --- Nodes: areas always, blocks unless they are drawn as chips at System level.
  const nodeCache = useRef(new Map<Id, Node>());
  const target = useMemo(() => {
    const cache = nodeCache.current;
    const next = new Map<Id, Node>();
    const out: Node[] = [];
    const push = (box: Box) => {
      const old = cache.get(box.id);
      const same = old && old.position.x === box.x && old.position.y === box.y && old.width === box.w && old.height === box.h && old.parentId === (box.parent ?? undefined);
      const node = same ? old : makeNode(box, box.x, box.y, box.w, box.h);
      next.set(box.id, node);
      out.push(node);
    };
    const areas: Box[] = [];
    const blocks: Box[] = [];
    for (const box of display.values()) (box.kind === 'area' ? areas : blocks).push(box);
    areas.sort((a, b) => a.depth - b.depth);
    for (const box of areas) push(box);
    for (const box of blocks) if (level !== 'system' || box.parent === null) push(box);
    nodeCache.current = next;
    return out;
  }, [display, level]);

  const [nodes, setNodes] = useState<Node[]>([]);
  const live = useRef<Node[]>([]);
  live.current = nodes;
  const dragging = useRef(false);
  const frame = useRef(0);

  useEffect(() => {
    cancelAnimationFrame(frame.current);
    if (dragging.current) return;
    const from = new Map(live.current.map((n) => [n.id, n]));
    const moving = new Set<Id>();
    for (const t of target) {
      const f = from.get(t.id);
      if (f && f.parentId === t.parentId && (f.position.x !== t.position.x || f.position.y !== t.position.y || f.width !== t.width || f.height !== t.height)) moving.add(t.id);
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (moving.size === 0 || reduced || target.length > 700 || live.current.length === 0) {
      setNodes(target);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 250);
      if (t >= 1) {
        setNodes(target);
        return;
      }
      const k = 1 - (1 - t) ** 3;
      const mix = (a: number, b: number) => a + (b - a) * k;
      setNodes(
        target.map((n) => {
          const f = from.get(n.id);
          if (!f || !moving.has(n.id)) return n;
          const w = mix(f.width ?? n.width!, n.width!);
          const h = mix(f.height ?? n.height!, n.height!);
          return { ...n, position: { x: mix(f.position.x, n.position.x), y: mix(f.position.y, n.position.y) }, width: w, height: h, handles: handlesFor(w, h, n.type === 'block') };
        }),
      );
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [target]);

  // --- Arrows, with each one given its own spot along the side it attaches to.
  const edges = useMemo(() => {
    if (!index) return [];
    const links = level === 'system' ? index.areaLinks : index.links;
    type End = { key: string; other: number };
    const sides = new Map<string, End[]>();
    const picked: { id: string; from: Id; to: Id; sk: string; tk: string; src: number; tgt: number }[] = [];
    const opposite: Record<Side, Side> = { down: 'up', up: 'down', left: 'right', right: 'left' };
    for (const link of links) {
      const a = display.get(link.from);
      const b = display.get(link.to);
      if (!a || !b) continue;
      const ra = { x: a.ax, y: a.ay, w: a.w, h: a.h };
      const rb = { x: b.ax, y: b.ay, w: b.w, h: b.h };
      const side = sideOf(ra, rb);
      const vertical = side === 'down' || side === 'up';
      const sk = `${link.from}:${side}`;
      const tk = `${link.to}:${opposite[side]}`;
      const add = (key: string, other: number) => {
        const list = sides.get(key);
        if (list) list.push({ key: link.id, other });
        else sides.set(key, [{ key: link.id, other }]);
      };
      add(sk, vertical ? rb.x + rb.w / 2 : rb.y + rb.h / 2);
      add(tk, vertical ? ra.x + ra.w / 2 : ra.y + ra.h / 2);
      picked.push({ id: link.id, from: link.from, to: link.to, sk, tk, src: vertical ? ra.x + ra.w / 2 : ra.y + ra.h / 2, tgt: vertical ? rb.x + rb.w / 2 : rb.y + rb.h / 2 });
    }
    const fraction = new Map<string, number>();
    for (const [key, list] of sides) {
      list.sort((p, q) => p.other - q.other);
      list.forEach((end, i) => fraction.set(`${key}|${end.key}`, slot(i, list.length)));
    }
    // Label order: among arrows arriving on one side from the same direction, the one that
    // attaches nearest the far edge gets the label closest to the block.
    const rank = new Map<string, number>();
    const arrivals = new Map<string, typeof picked>();
    for (const p of picked) {
      const key = `${p.tk}:${p.src < p.tgt ? 'a' : 'b'}`;
      const list = arrivals.get(key);
      if (list) list.push(p);
      else arrivals.set(key, [p]);
    }
    for (const [key, list] of arrivals) {
      const fromLow = key.endsWith(':a');
      list.sort((p, q) => ((fraction.get(`${p.tk}|${p.id}`) ?? 0.5) - (fraction.get(`${q.tk}|${q.id}`) ?? 0.5)) * (fromLow ? -1 : 1));
      list.forEach((p, i) => rank.set(p.id, i));
    }
    return picked.map<Edge>((p) => ({
      id: p.id,
      source: p.from,
      target: p.to,
      sourceHandle: 'cs',
      targetHandle: 'ct',
      type: 'link',
      selectable: false,
      focusable: false,
      data: { s: fraction.get(`${p.sk}|${p.id}`) ?? 0.5, t: fraction.get(`${p.tk}|${p.id}`) ?? 0.5, r: rank.get(p.id) ?? 0 },
    }));
  }, [index, display, level]);

  // --- Chips for System level.
  const chips = useMemo(() => {
    const out = new Map<Id, { ok: string; fail: string }>();
    if (level !== 'system' || !index) return out;
    for (const box of display.values()) {
      if (box.kind !== 'block' || !box.parent) continue;
      const failing = run ? (index.testsOf.get(box.id) ?? []).some((t) => run.results[t.id] === 'failed') : false;
      const entry = out.get(box.parent) ?? { ok: '', fail: '' };
      const d = roundRect(box.x, box.y, box.w, box.h, 12);
      if (failing) entry.fail += d;
      else entry.ok += d;
      out.set(box.parent, entry);
    }
    return out;
  }, [display, level, index, run]);

  const titles = useMemo(() => {
    if (level === 'system') return [];
    const out: { id: Id; x: number; y: number; w: number }[] = [];
    for (const box of display.values()) if (box.kind === 'area') out.push({ id: box.id, x: box.ax, y: box.ay, w: box.w });
    return out;
  }, [display, level]);

  // --- Camera.
  const fitted = useRef(-1);
  useEffect(() => {
    if (display.size === 0 || fitted.current === layoutEpoch) return;
    fitted.current = layoutEpoch;
    requestAnimationFrame(() => camera.fit(false));
  }, [display, layoutEpoch]);

  const bandRef = useRef(band);
  bandRef.current = band;
  const onMove = useCallback((_: unknown, vp: { zoom: number }) => {
    const next = bandFor(vp.zoom, bandRef.current);
    if (next !== bandRef.current) useDeck.getState().setBand(next);
    setZoomPct((prev) => {
      const pct = Math.round(vp.zoom * 100);
      return pct === prev ? prev : pct;
    });
  }, []);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    // A mouse wheel zooms at the cursor. A trackpad scrolls to pan and pinches to zoom.
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return;
      const trackpad = e.deltaMode === 0 && (e.deltaX !== 0 || Math.abs(e.deltaY) < 50);
      setPanOnScroll((cur) => (cur === trackpad ? cur : trackpad));
    };
    el.addEventListener('wheel', onWheel, { capture: true, passive: true });
    return () => el.removeEventListener('wheel', onWheel, { capture: true });
  }, []);

  const onNodesChange = useCallback((changes: NodeChange[]) => setNodes((ns) => applyNodeChanges(changes, ns)), []);

  const onConnectEnd: OnConnectEnd = useCallback((event, state) => {
    const from = state.fromNode?.id;
    const to = state.toNode?.id;
    if (!from || !to || from === to) return;
    const point = 'changedTouches' in event ? event.changedTouches[0]! : event;
    useDeck.getState().set({ popover: { kind: 'edge', from, to, x: point.clientX, y: point.clientY } });
  }, []);

  const style = useMemo(() => bandVars(band) as React.CSSProperties, [band]);
  const minimapColor = useCallback(
    (n: Node) => {
      if (n.type !== 'area' || !index) return 'var(--line-strong)';
      const { hue, depth } = areaStyle(index, n.id);
      return `hsl(${hue} 40% 55% / ${depth ? 0.12 : 0.22})`;
    },
    [index],
  );

  return (
    <div className="dd-flow" ref={wrap} data-level={level} data-band={band} data-connecting={connecting ? '1' : '0'} data-testid="canvas" style={{ width: '100%', height: '100%' }}>
      <ChipContext.Provider value={chips}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          style={style}
          onInit={(instance) => camera.attach(instance, wrap.current)}
          onNodesChange={onNodesChange}
          onMove={onMove}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          onlyRenderVisibleElements
          panOnDrag={[0, 1]}
          panOnScroll={panOnScroll}
          zoomOnDoubleClick={false}
          nodeDragThreshold={3}
          snapToGrid
          snapGrid={[8, 8]}
          nodesConnectable={level === 'blocks'}
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          disableKeyboardA11y
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          connectionLineType={ConnectionLineType.SmoothStep}
          connectionRadius={24}
          isValidConnection={(c) => c.source !== c.target}
          onConnectEnd={onConnectEnd}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => {
            const st = useDeck.getState();
            if (node.type === 'area' && level !== 'system') st.select(null);
            else st.select(node.id);
          }}
          onNodeDoubleClick={(_, node) => {
            if (node.type === 'block' || level === 'system') useDeck.getState().select(node.id, { fly: true });
          }}
          onEdgeClick={(_, edge) => useDeck.getState().select(edge.id)}
          onPaneClick={() => useDeck.getState().select(null)}
          onNodeMouseEnter={(_, node) => {
            if (dragging.current) return;
            if (node.type === 'block' || level === 'system') useDeck.getState().hover(node.id);
          }}
          onNodeMouseLeave={() => useDeck.getState().hover(null)}
          onEdgeMouseEnter={(_, edge) => useDeck.getState().hover(edge.id)}
          onEdgeMouseLeave={() => useDeck.getState().hover(null)}
          onNodeDragStart={() => {
            dragging.current = true;
            useDeck.getState().hover(null);
          }}
          onNodeDragStop={(_, node) => {
            dragging.current = false;
            const st = useDeck.getState();
            const box = display.get(node.id);
            const base = st.positions[node.id];
            const push = box && base ? box.y - base.y : 0;
            const inArea = Boolean(node.parentId);
            st.moveNode(node.id, {
              x: inArea ? Math.max(AREA.side, node.position.x) : node.position.x,
              y: inArea ? Math.max(AREA.top, node.position.y - push) : node.position.y - push,
            });
          }}
        >
          <ViewportPortal>
            <AreaTitles boxes={titles} />
          </ViewportPortal>
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.4} color="var(--grid)" />
          <MiniMap pannable zoomable nodeColor={minimapColor} nodeStrokeWidth={0} nodeBorderRadius={6} maskColor="var(--scrim)" bgColor="var(--chrome)" style={{ width: 188, height: 124 }} />
        </ReactFlow>
      </ChipContext.Provider>

      <div className="dd-controls">
        <button type="button" className="dd-icon-btn" aria-label="Zoom out" title="Zoom out  (−)" onClick={() => camera.zoomBy(1 / 1.3)}>
          <Minus size={15} />
        </button>
        <button type="button" className="dd-icon-btn" aria-label="Zoom in" title="Zoom in  (+)" onClick={() => camera.zoomBy(1.3)}>
          <Plus size={15} />
        </button>
        <button type="button" className="dd-icon-btn" aria-label="Fit everything" title="Fit everything  (0)" data-testid="fit" onClick={() => camera.fit()}>
          <Maximize2 size={14} />
        </button>
        <span className="dd-sep" />
        <span className="dd-level" data-testid="level">
          <b>{LEVEL_NAME[level]}</b> · {zoomPct}%
        </span>
      </div>
      {laying || status === 'loading' ? <div className="dd-loading">{status === 'loading' ? 'Loading the deck…' : 'Arranging the map…'}</div> : null}
      <span hidden data-testid="zoom" data-zoom={rf ? zoomPct : 0} data-min={BANDS[0]} data-level-of={levelOf(band)} />
    </div>
  );
}

export function FlowMap() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}

export const BLOCK_WIDTH = BLOCK_W;
