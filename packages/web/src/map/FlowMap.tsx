// The React Flow implementation of the map. Everything outside this folder talks to it
// through the store and the camera, so the renderer can be replaced (spec §8.2).
import type { DeckIndex, Id } from '@decker/deck-model';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  type Edge,
  type Node,
  type NodeChange,
  type NodeHandle,
  type OnConnectEnd,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useConnection,
  useReactFlow,
  ViewportPortal,
} from '@xyflow/react';
import { Maximize2, Minus, Network, Plus, Shapes } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AREA, areaAt, type Box, computeDisplay, type Display } from '../model/layout';
import { BLOCK_W, blockHeight, collapsedHeight } from '../model/measure';
import { currentRun, useDeck, useLevel, type View } from '../state/store';
import { AreaNode, AreaTitles, ChipContext } from './AreaNode';
import { BlockNode } from './BlockNode';
import {
  BANDS,
  bandFor,
  bandVars,
  camera,
  levelOf,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEPS,
  zoomStepOf,
} from './camera';
import { type Side, sideOf, slot } from './geometry';
import { LabelLayer, LinkEdge } from './LinkEdge';
import { MiniMap } from './MiniMap';
import { PartNode, partLod } from './PartNode';
import { PlainEdge } from './PlainEdge';

const nodeTypes = { area: AreaNode, block: BlockNode, part: PartNode };
const edgeTypes = { link: LinkEdge, plain: PlainEdge };
const LEVEL_NAME = { system: 'System', architecture: 'Architecture', blocks: 'Blocks' } as const;
const NO_DISPLAY: Display = new Map();

/**
 * The switch between the two views (spec §3.13). It shows the view that is on screen, and
 * pressing it goes to the other one.
 */
function ViewToggle() {
  const view = useDeck((s) => s.view);
  const other: View = view === 'simple' ? 'advanced' : 'simple';
  const word = view === 'simple' ? 'Simple' : 'Advanced';
  return (
    <button
      type="button"
      className="dd-view-toggle"
      data-testid="view-toggle"
      data-view={view}
      aria-label={`${word} view. Switch to the ${other} view.`}
      title={
        view === 'simple'
          ? 'Simple view: the big picture in plain words. Switch to Advanced  (S)'
          : 'Advanced view: every block and arrow. Switch to Simple  (S)'
      }
      onClick={() => useDeck.getState().setView(other)}
    >
      {view === 'simple' ? <Shapes size={15} /> : <Network size={15} />}
      <span key={view}>{word}</span>
    </button>
  );
}

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
    // Arrows attach to these declared bounds, so areas, and cards shown by name only, mount no
    // handle elements at all.
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
    handles: handlesFor(w, h, box.kind !== 'area'),
  };
}

/** Whether the canvas is big enough for fitting the map to it to mean anything. */
const hasRoom = (el: HTMLElement | null) => (el?.clientWidth ?? 0) >= 120 && (el?.clientHeight ?? 0) >= 120;

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
  const view = useDeck((s) => s.view);
  const simple = useDeck((s) => s.simple);
  const simpleLayout = useDeck((s) => s.simpleLayout);
  const zoomStep = useDeck((s) => s.zoomStep);
  const level = useLevel();
  const rf = useReactFlow();
  const connecting = useConnection((c) => c.inProgress);
  const wrap = useRef<HTMLDivElement>(null);
  const [panOnScroll, setPanOnScroll] = useState(false);
  const [labelLayer, setLabelLayer] = useState<Element | null>(null);
  const [zoomPct, setZoomPct] = useState(100);

  const full: Display = useMemo(() => {
    if (!index || view !== 'advanced') return NO_DISPLAY;
    const rest = restHeights(index);
    const st = { expanded, internals, testsOpen: (id: Id) => allTests !== testsToggled.has(id), run };
    const grown = expanded.size > 0 || allTests || testsToggled.size > 0;
    const height = (id: Id) =>
      grown && (expanded.has(id) || st.testsOpen(id)) ? blockHeight(index, id, st) : (rest.get(id) ?? 100);
    return computeDisplay(index, positions, height, (id) => rest.get(id) ?? 100);
  }, [index, view, positions, expanded, internals, testsToggled, allTests, run]);

  // The simple view has its own arrangement: a few parts, laid out for their connections.
  const parts: Display = useMemo(() => {
    const out: Display = new Map();
    if (view !== 'simple' || !simpleLayout) return out;
    for (const [id, b] of simpleLayout.boxes)
      out.set(id, {
        id,
        kind: 'part',
        parent: null,
        depth: 0,
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        ax: b.x,
        ay: b.y,
      });
    return out;
  }, [view, simpleLayout]);
  const display = view === 'simple' ? parts : full;

  useEffect(() => {
    camera.setDisplay(display);
    // The simple view is fitted clear of the controls around it, and never magnified past full size.
    camera.setFrame(view === 'simple' ? { top: 66, right: 36, bottom: 70, left: 36, maxZoom: 1 } : null);
    const all = view === 'simple' ? simpleLayout?.bounds : undefined;
    camera.setWhole(all ? { x: all.x, y: all.y, width: all.w, height: all.h } : null);
  }, [display, view, simpleLayout]);

  // --- Nodes: areas always, blocks unless they are drawn as chips at System level.
  const nodeCache = useRef(new Map<Id, Node>());
  const target = useMemo(() => {
    const cache = nodeCache.current;
    const next = new Map<Id, Node>();
    const out: Node[] = [];
    const push = (box: Box) => {
      const old = cache.get(box.id);
      const same =
        old &&
        old.position.x === box.x &&
        old.position.y === box.y &&
        old.width === box.w &&
        old.height === box.h &&
        old.parentId === (box.parent ?? undefined);
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
      if (
        f &&
        f.parentId === t.parentId &&
        (f.position.x !== t.position.x ||
          f.position.y !== t.position.y ||
          f.width !== t.width ||
          f.height !== t.height)
      )
        moving.add(t.id);
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
          return {
            ...n,
            position: { x: mix(f.position.x, n.position.x), y: mix(f.position.y, n.position.y) },
            width: w,
            height: h,
            handles: handlesFor(w, h, n.type !== 'area'),
          };
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
    if (view === 'simple')
      return (simple?.links ?? [])
        .filter((l) => !l.hidden && display.has(l.from) && display.has(l.to))
        .map<Edge>((l) => ({
          id: l.id,
          source: l.from,
          target: l.to,
          sourceHandle: 'cs',
          targetHandle: 'ct',
          type: 'plain',
          selectable: false,
          focusable: false,
        }));
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
      picked.push({
        id: link.id,
        from: link.from,
        to: link.to,
        sk,
        tk,
        src: vertical ? ra.x + ra.w / 2 : ra.y + ra.h / 2,
        tgt: vertical ? rb.x + rb.w / 2 : rb.y + rb.h / 2,
      });
    }
    const fraction = new Map<string, number>();
    for (const [key, list] of sides) {
      list.sort((p, q) => p.other - q.other);
      list.forEach((end, i) => {
        fraction.set(`${key}|${end.key}`, slot(i, list.length));
      });
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
      list.sort(
        (p, q) =>
          ((fraction.get(`${p.tk}|${p.id}`) ?? 0.5) - (fraction.get(`${q.tk}|${q.id}`) ?? 0.5)) *
          (fromLow ? -1 : 1),
      );
      list.forEach((p, i) => {
        rank.set(p.id, i);
      });
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
      data: {
        s: fraction.get(`${p.sk}|${p.id}`) ?? 0.5,
        t: fraction.get(`${p.tk}|${p.id}`) ?? 0.5,
        r: rank.get(p.id) ?? 0,
      },
    }));
  }, [index, display, level, view, simple]);

  // --- Chips for System level.
  const chips = useMemo(() => {
    const out = new Map<Id, { ok: string; fail: string }>();
    if (level !== 'system' || !index) return out;
    for (const box of display.values()) {
      if (box.kind !== 'block' || !box.parent) continue;
      const failing = run
        ? (index.testsOf.get(box.id) ?? []).some((t) => run.results[t.id] === 'failed')
        : false;
      const entry = out.get(box.parent) ?? { ok: '', fail: '' };
      const d = roundRect(box.x, box.y, box.w, box.h, 12);
      if (failing) entry.fail += d;
      else entry.ok += d;
      out.set(box.parent, entry);
    }
    return out;
  }, [display, level, index, run]);

  const titles = useMemo(() => {
    if (level === 'system' || view === 'simple') return [];
    const out: { id: Id; x: number; y: number; w: number }[] = [];
    for (const box of display.values())
      if (box.kind === 'area') out.push({ id: box.id, x: box.ax, y: box.ay, w: box.w });
    return out;
  }, [display, level, view]);

  // --- Camera.
  const fitted = useRef(-1);
  const roomAtFit = useRef(false);
  useEffect(() => {
    if (display.size === 0 || fitted.current === layoutEpoch) return;
    fitted.current = layoutEpoch;
    requestAnimationFrame(() => {
      roomAtFit.current = hasRoom(wrap.current);
      camera.fit(false);
    });
  }, [display, layoutEpoch]);
  // A map first drawn while its window was hidden, or a sliver, was fitted to nothing. It is
  // fitted again the first time it has room. After that the camera is the engineer's.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (fitted.current < 0 || !hasRoom(wrap.current)) return;
      const st = useDeck.getState();
      // The simple view stays fitted to its window until someone moves it. The panel opening
      // is not the window changing: the picture keeps its size and gives up its right side.
      const follow = st.view === 'simple' && camera.atFit && !st.panelOpen;
      if (roomAtFit.current && !follow) return;
      roomAtFit.current = true;
      camera.fit(false);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Each view keeps its own camera. Going to the other one returns to where it was left, or
  // fits it the first time. Drilling in from a part goes straight to that part's area.
  type Place = { at: { x: number; y: number; zoom: number }; fitted: boolean };
  const shown = useRef<View | null>(null);
  const left = useRef<Partial<Record<View, Place>>>({});
  const heading = useRef<{ until: number; to: Place | null }>({ until: 0, to: null });
  useEffect(() => {
    if (display.size === 0 || shown.current === view) return;
    const from = shown.current;
    shown.current = view;
    if (from === null) return; // the first paint is fitted above
    // Leaving a view while its camera is still travelling: what is kept is where it was going.
    if (performance.now() >= heading.current.until)
      left.current[from] = { at: camera.viewport(), fitted: camera.atFit };
    else if (heading.current.to) left.current[from] = heading.current.to;
    else delete left.current[from];
    requestAnimationFrame(() => {
      const st = useDeck.getState();
      const focus = st.viewFocus;
      const back = left.current[view];
      const now = performance.now();
      if (focus && camera.box(Array.isArray(focus) ? focus[0]! : focus)) {
        camera.flyTo(focus);
        heading.current = { until: now + 460, to: null };
      } else if (back && !back.fitted) {
        camera.moved();
        void rf.setViewport(back.at, { duration: 300 });
        heading.current = { until: now + 340, to: back };
      } else {
        // It was showing everything, or has never been shown: show everything.
        camera.fit();
        heading.current = { until: now + 400, to: back ?? null };
      }
      if (focus) st.set({ viewFocus: null });
    });
  }, [view, display, rf]);

  // A request or a new connection changes the simple view's arrangement. While nobody has
  // moved the camera, the whole picture is kept in view. Otherwise the selection is.
  const arranged = useRef(simpleLayout);
  useEffect(() => {
    if (arranged.current === simpleLayout) return;
    const first = arranged.current === null;
    arranged.current = simpleLayout;
    if (first || view !== 'simple' || shown.current !== 'simple') return;
    const st = useDeck.getState();
    requestAnimationFrame(() => {
      if (camera.atFit && !st.panelOpen) camera.fit();
      else if (st.selectedId && camera.box(st.selectedId)) camera.reveal(st.selectedId);
    });
  }, [simpleLayout, view]);

  const bandRef = useRef(band);
  bandRef.current = band;
  const onMove = useCallback((_: unknown, vp: { zoom: number }) => {
    const next = bandFor(vp.zoom, bandRef.current);
    if (next !== bandRef.current) useDeck.getState().setBand(next);
    // The simple view's cards follow zoom in finer steps, with the same guard against flicker.
    // Only that view listens, so only that view pays for it.
    const st = useDeck.getState();
    const exact = vp.zoom * ZOOM_STEPS;
    if (st.view === 'simple' && (exact >= st.zoomStep + 1.03 || exact < st.zoomStep - 0.03))
      st.set({ zoomStep: zoomStepOf(vp.zoom) });
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

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((ns) => applyNodeChanges(changes, ns)),
    [],
  );

  // Dragging a block over another area offers to regroup it there (spec §3.8). The test point
  // is the middle of the card's title row, which is where a card is usually held.
  const dropAt = useCallback(
    (node: Node): { area: Box | null; ax: number; ay: number } => {
      const parent = node.parentId ? display.get(node.parentId) : undefined;
      const ax = (parent?.ax ?? 0) + node.position.x;
      const ay = (parent?.ay ?? 0) + node.position.y;
      if (node.type !== 'block') return { area: null, ax, ay };
      const hit = areaAt(display, ax + (node.width ?? BLOCK_W) / 2, ay + 20);
      return { area: hit && hit.id !== node.parentId ? hit : null, ax, ay };
    },
    [display],
  );

  const onConnectEnd: OnConnectEnd = useCallback((event, state) => {
    const from = state.fromNode?.id;
    const to = state.toNode?.id;
    if (!from || !to || from === to) return;
    const point = 'changedTouches' in event ? event.changedTouches[0]! : event;
    useDeck.getState().set({ popover: { kind: 'edge', from, to, x: point.clientX, y: point.clientY } });
  }, []);

  const style = useMemo(() => bandVars(band) as React.CSSProperties, [band]);

  return (
    <div
      className="dd-flow"
      ref={wrap}
      data-view={view}
      data-level={level}
      data-band={band}
      data-connecting={connecting ? '1' : '0'}
      data-testid="canvas"
      style={{ width: '100%', height: '100%' }}
    >
      <ChipContext.Provider value={chips}>
        <LabelLayer.Provider value={labelLayer}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            style={style}
            onInit={(instance) => {
              camera.attach(instance, wrap.current);
              setLabelLayer(wrap.current?.querySelector('.react-flow__edgelabel-renderer') ?? null);
            }}
            onNodesChange={onNodesChange}
            onMove={onMove}
            onMoveStart={(event) => {
              if (event) camera.moved();
            }}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            onlyRenderVisibleElements
            panOnDrag={[0, 1]}
            panOnScroll={panOnScroll}
            zoomOnDoubleClick={false}
            nodeDragThreshold={3}
            snapToGrid
            snapGrid={[8, 8]}
            nodesConnectable={view === 'simple' ? partLod(zoomStep) === 'full' : level === 'blocks'}
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
              else st.select(node.id, { later: node.type === 'part' });
            }}
            onNodeDoubleClick={(_, node) => {
              // A part opens: the advanced view, at that part's area.
              if (node.type === 'part') useDeck.getState().setView('advanced', { focus: node.id });
              else if (node.type === 'block' || level === 'system')
                useDeck.getState().select(node.id, { fly: true });
            }}
            onEdgeClick={(_, edge) => useDeck.getState().select(edge.id)}
            onPaneClick={() => useDeck.getState().select(null)}
            onNodeMouseEnter={(_, node) => {
              if (dragging.current) return;
              if (node.type !== 'area' || level === 'system') useDeck.getState().hover(node.id);
            }}
            onNodeMouseLeave={() => useDeck.getState().hover(null)}
            onEdgeMouseEnter={(_, edge) => useDeck.getState().hover(edge.id)}
            onEdgeMouseLeave={() => useDeck.getState().hover(null)}
            onNodeDragStart={() => {
              dragging.current = true;
              useDeck.getState().hover(null);
            }}
            onNodeDrag={(_, node) => {
              const st = useDeck.getState();
              const over = st.review ? null : (dropAt(node).area?.id ?? null);
              if (over !== st.dropArea) st.set({ dropArea: over });
            }}
            onNodeDragStop={(_, node) => {
              dragging.current = false;
              const st = useDeck.getState();
              const drop = st.review ? null : dropAt(node);
              if (drop?.area) {
                const snap = (v: number) => Math.round(v / 8) * 8;
                st.moveNode(
                  node.id,
                  {
                    x: Math.max(AREA.side, snap(drop.ax - drop.area.ax)),
                    y: Math.max(AREA.top, snap(drop.ay - drop.area.ay)),
                  },
                  drop.area.id,
                );
                return;
              }
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
          </ReactFlow>
        </LabelLayer.Provider>
      </ChipContext.Provider>

      <ViewToggle />
      {view === 'advanced' ? <MiniMap index={index} display={display} /> : null}
      <div className="dd-controls">
        <button
          type="button"
          className="dd-icon-btn"
          aria-label="Zoom out"
          title="Zoom out  (−)"
          onClick={() => camera.zoomBy(1 / 1.3)}
        >
          <Minus size={15} />
        </button>
        <button
          type="button"
          className="dd-icon-btn"
          aria-label="Zoom in"
          title="Zoom in  (+)"
          onClick={() => camera.zoomBy(1.3)}
        >
          <Plus size={15} />
        </button>
        <button
          type="button"
          className="dd-icon-btn"
          aria-label="Fit everything"
          title="Fit everything  (0)"
          data-testid="fit"
          onClick={() => camera.fit()}
        >
          <Maximize2 size={14} />
        </button>
        <span className="dd-sep" />
        <span className="dd-level" data-testid="level">
          <b>{view === 'simple' ? 'Simple' : LEVEL_NAME[level]}</b> · {zoomPct}%
          {view === 'simple' && simple && simple.connections.drawn < simple.connections.built ? (
            <span
              data-testid="connections-note"
              title="There are more connections than a picture can hold. The busiest are drawn. Each part's panel lists all of its own."
            >
              {' '}
              · {simple.connections.drawn} of {simple.connections.built} connections
            </span>
          ) : null}
        </span>
      </div>
      {status === 'loading' || (view === 'simple' ? !simpleLayout && status === 'ready' : laying) ? (
        <div className="dd-loading">{status === 'loading' ? 'Loading the deck…' : 'Arranging the map…'}</div>
      ) : null}
      <span
        hidden
        data-testid="zoom"
        data-zoom={rf ? zoomPct : 0}
        data-min={BANDS[0]}
        data-level-of={levelOf(band)}
      />
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
