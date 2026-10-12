// The minimap: the areas of the whole map and a frame for what is on screen.
// It draws areas only and follows the camera with one subscription, so it costs the same
// on a map of fifteen hundred blocks as on one of forty.
import type { DeckIndex, Id } from '@decker/deck-model';
import { type ReactFlowState, useReactFlow, useStore } from '@xyflow/react';
import { memo, useMemo, useRef } from 'react';
import { boundsOf, type Display } from '../model/layout';
import { areaStyle } from './AreaNode';
import { camera } from './camera';

const W = 188;
const H = 124;
const PAD = 8;

const frame = (s: ReactFlowState) =>
  `${s.transform[0]}|${s.transform[1]}|${s.transform[2]}|${s.width}|${s.height}`;

const Areas = memo(function Areas({
  index,
  boxes,
}: {
  index: DeckIndex;
  boxes: { id: Id; x: number; y: number; w: number; h: number; depth: number }[];
}) {
  return (
    <>
      {boxes.map((b) => (
        <rect
          key={b.id}
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          rx={2}
          fill={`oklch(0.72 0.09 ${areaStyle(index, b.id).hue} / ${b.depth ? 0.16 : 0.3})`}
        />
      ))}
    </>
  );
});

export function MiniMap({ index, display }: { index: DeckIndex | null; display: Display }) {
  const rf = useReactFlow();
  const view = useStore(frame);
  const svg = useRef<SVGSVGElement>(null);
  const held = useRef(false);

  const map = useMemo(() => {
    const bounds = boundsOf(display);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    const scale = Math.min((W - PAD * 2) / bounds.width, (H - PAD * 2) / bounds.height);
    const ox = (W - bounds.width * scale) / 2 - bounds.x * scale;
    const oy = (H - bounds.height * scale) / 2 - bounds.y * scale;
    const boxes = [];
    for (const box of display.values()) {
      if (box.kind === 'block' || box.depth > 1) continue;
      const w = box.w * scale;
      const h = box.h * scale;
      if (w < 1.5 || h < 1.5) continue;
      boxes.push({ id: box.id, x: box.ax * scale + ox, y: box.ay * scale + oy, w, h, depth: box.depth });
    }
    return { scale, ox, oy, boxes };
  }, [display]);

  if (!index || !map) return null;
  const [tx, ty, zoom, width, height] = view.split('|').map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const vx = (-tx / zoom) * map.scale + map.ox;
  const vy = (-ty / zoom) * map.scale + map.oy;
  const vw = (width / zoom) * map.scale;
  const vh = (height / zoom) * map.scale;

  const go = (e: React.PointerEvent) => {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left - map.ox) / map.scale;
    const y = (e.clientY - rect.top - map.oy) / map.scale;
    void rf.setCenter(x, y, { zoom: rf.getZoom() });
  };

  return (
    <div className="dd-minimap" data-testid="minimap">
      <svg
        ref={svg}
        width={W}
        height={H}
        role="img"
        aria-label="Minimap. Drag to move the view."
        onPointerDown={(e) => {
          held.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          go(e);
        }}
        onPointerMove={(e) => {
          if (held.current) go(e);
        }}
        onPointerUp={() => {
          held.current = false;
        }}
        onPointerCancel={() => {
          held.current = false;
        }}
        onWheel={(e) => camera.zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2)}
      >
        <Areas index={index} boxes={map.boxes} />
        {/* Everything outside the frame is dimmed, so the frame reads as a window. */}
        <path
          className="dd-minimap-mask"
          fillRule="evenodd"
          d={`M0,0H${W}V${H}H0Z M${vx},${vy}h${vw}v${vh}h${-vw}Z`}
        />
        <rect
          className="dd-minimap-frame"
          data-testid="minimap-frame"
          x={vx}
          y={vy}
          width={Math.max(2, vw)}
          height={Math.max(2, vh)}
          rx={1.5}
        />
      </svg>
    </div>
  );
}
