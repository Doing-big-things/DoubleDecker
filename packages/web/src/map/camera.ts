// The camera: jumps, history, and the zoom bands that drive level of detail (spec §3.4, §3.5).
import type { Id } from '@decker/deck-model';
import { getViewportForBounds, type ReactFlowInstance, type Viewport } from '@xyflow/react';
import { type Box, boundsOf, type Display } from '../model/layout';

export type Level = 'system' | 'architecture' | 'blocks';

/** Lower zoom bound of each band. Text inside a band is sized to be legible at its lower bound. */
export const BANDS = [0.05, 0.07, 0.1, 0.14, 0.2, 0.3, 0.36, 0.43, 0.51, 0.6, 0.67, 0.76, 0.88, 1] as const;
const FIRST_ARCH = 5;
const FIRST_BLOCKS = 9;
/** The simple view follows zoom in steps of 4%, finer than the bands above. */
export const ZOOM_STEPS = 25;
export const zoomStepOf = (zoom: number): number => Math.floor(zoom * ZOOM_STEPS + 0.001);
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 2.5;

export function levelOf(band: number): Level {
  return band >= FIRST_BLOCKS ? 'blocks' : band >= FIRST_ARCH ? 'architecture' : 'system';
}

/** The band for a zoom, with a little hysteresis so thresholds do not flicker. */
export function bandFor(zoom: number, current: number): number {
  let band = current;
  while (band < BANDS.length - 1 && zoom >= BANDS[band + 1]! * 1.012) band += 1;
  while (band > 0 && zoom < BANDS[band]! * 0.988) band -= 1;
  return band;
}

/** Text scale on block cards: 1 at full size, larger when zoomed out so nothing drops below 11 px. */
export function textScale(band: number): number {
  return band >= FIRST_BLOCKS ? Math.max(1, 0.88 / BANDS[band]!) : 1;
}

export function bandVars(band: number): Record<string, string> {
  const lower = BANDS[band]!;
  const level = levelOf(band);
  const ts = textScale(band);
  const title =
    level === 'blocks' ? 14 * ts : level === 'architecture' ? Math.min(13 / lower, 40) : 14 / lower;
  return {
    '--ts': ts.toFixed(3),
    '--ms': Math.max(1, 1 / lower).toFixed(3),
    '--name-fs': `${(11.5 / lower).toFixed(1)}px`,
    '--title-fs': `${title.toFixed(1)}px`,
    '--grid-o': band >= FIRST_BLOCKS ? '1' : band === FIRST_BLOCKS - 1 ? '0.45' : '0',
  };
}

interface Entry {
  viewport: Viewport;
  selectedId: Id | null;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let rf: ReactFlowInstance | null = null;
let element: HTMLElement | null = null;
let display: Display = new Map();
// Blocks by grid cell, built when first asked for, so "is a card here?" does not scan the map.
let cells: Map<string, Box[]> | null = null;
const CELL = 512;
// Room kept clear when fitting, for controls that sit over the canvas, and the most a fit may magnify.
let frame: { top: number; right: number; bottom: number; left: number; maxZoom: number } | null = null;
// Whether the view is still the one the last fit left: nothing has moved it since.
let atFit = false;
// What "everything" is when it is more than the boxes: the simple view's lines and labels.
let whole: { x: number; y: number; width: number; height: number } | null = null;
const past: Entry[] = [];
const future: Entry[] = [];

function duration(to: { x: number; y: number }): number {
  if (!rf || !element || reducedMotion()) return 0;
  const vp = rf.getViewport();
  const cx = (element.clientWidth / 2 - vp.x) / vp.zoom;
  const cy = (element.clientHeight / 2 - vp.y) / vp.zoom;
  const dist = Math.hypot(to.x - cx, to.y - cy) * vp.zoom;
  return Math.round(Math.min(400, 300 + dist / 30));
}

export const camera = {
  attach(instance: ReactFlowInstance | null, el: HTMLElement | null): void {
    rf = instance;
    element = el;
  },
  setDisplay(d: Display): void {
    display = d;
    cells = null;
  },
  /** Fit to this instead of to the boxes alone, or pass null to go back to the boxes. */
  setWhole(next: typeof whole): void {
    whole = next;
  },
  /** Whether nothing has moved the camera since everything was last fitted. */
  get atFit(): boolean {
    return atFit;
  },
  /** The engineer panned or zoomed by hand. */
  moved(): void {
    atFit = false;
  },
  /** Keep margins clear when fitting everything, or pass null to fit edge to edge. */
  setFrame(next: typeof frame): void {
    frame = next;
  },
  /** Whether a rectangle, in flow coordinates, touches any block's card. */
  coversBlock(x0: number, y0: number, x1: number, y1: number): boolean {
    if (!cells) {
      cells = new Map();
      for (const box of display.values()) {
        if (box.kind !== 'block') continue;
        for (let cx = Math.floor(box.ax / CELL); cx <= Math.floor((box.ax + box.w) / CELL); cx++)
          for (let cy = Math.floor(box.ay / CELL); cy <= Math.floor((box.ay + box.h) / CELL); cy++) {
            const key = `${cx}:${cy}`;
            const list = cells.get(key);
            if (list) list.push(box);
            else cells.set(key, [box]);
          }
      }
    }
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++)
        for (const b of cells.get(`${cx}:${cy}`) ?? [])
          if (x0 < b.ax + b.w && b.ax < x1 && y0 < b.ay + b.h && b.ay < y1) return true;
    return false;
  },
  get ready(): boolean {
    return rf !== null;
  },
  /** The underlying React Flow instance, for tests and debugging. */
  instance(): ReactFlowInstance | null {
    return rf;
  },
  viewport(): Viewport {
    return rf?.getViewport() ?? { x: 0, y: 0, zoom: 1 };
  },
  box(id: Id) {
    return display.get(id);
  },
  /** Flow coordinates of a point on screen. */
  toFlow(clientX: number, clientY: number): { x: number; y: number } {
    return rf ? rf.screenToFlowPosition({ x: clientX, y: clientY }) : { x: clientX, y: clientY };
  },
  center(): { x: number; y: number } {
    const vp = this.viewport();
    return {
      x: ((element?.clientWidth ?? 0) / 2 - vp.x) / vp.zoom,
      y: ((element?.clientHeight ?? 0) / 2 - vp.y) / vp.zoom,
    };
  },
  visibleRect(): { x: number; y: number; w: number; h: number } {
    const vp = this.viewport();
    return {
      x: -vp.x / vp.zoom,
      y: -vp.y / vp.zoom,
      w: (element?.clientWidth ?? 0) / vp.zoom,
      h: (element?.clientHeight ?? 0) / vp.zoom,
    };
  },
  record(selectedId: Id | null): void {
    if (!rf) return;
    past.push({ viewport: rf.getViewport(), selectedId });
    if (past.length > 60) past.shift();
    future.length = 0;
  },
  fit(animate = true): void {
    const bounds = whole ?? boundsOf(display);
    if (!rf || !bounds) return;
    atFit = true;
    const duration = animate && !reducedMotion() ? 350 : 0;
    const w = (element?.clientWidth ?? 0) - (frame ? frame.left + frame.right : 0);
    const h = (element?.clientHeight ?? 0) - (frame ? frame.top + frame.bottom : 0);
    if (frame && w >= 120 && h >= 120) {
      const vp = getViewportForBounds(bounds, w, h, MIN_ZOOM, frame.maxZoom, 0);
      void rf.setViewport(
        { x: vp.x + frame.left, y: vp.y + frame.top, zoom: vp.zoom },
        { duration, ease: easeOut, interpolate: 'smooth' },
      );
      return;
    }
    void rf.fitBounds(bounds, {
      padding: 0.06,
      duration,
      ease: easeOut,
      interpolate: 'smooth',
    });
  },
  /** Fly to one or more nodes. Blocks land at a zoom where their card can be read. */
  flyTo(ids: Id | Id[], opts: { zoom?: number; fitArea?: boolean } = {}): void {
    if (!rf || !element) return;
    const list = Array.isArray(ids) ? ids : [ids];
    const bounds = boundsOf(display, list);
    if (!bounds) return;
    atFit = false;
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const only = list.length === 1 ? display.get(list[0]!) : undefined;
    if (only?.kind === 'block' && !opts.fitArea) {
      const now = rf.getViewport().zoom;
      const zoom = opts.zoom ?? (now >= 0.88 && now <= 1.5 ? now : 1);
      void rf.setCenter(cx, cy, {
        zoom,
        duration: duration({ x: cx, y: cy }),
        ease: easeOut,
        interpolate: 'smooth',
      });
      return;
    }
    // Fit the target, but never magnify past 100%: a fly-to lands where text is at its designed size.
    const viewport = getViewportForBounds(
      bounds,
      element.clientWidth,
      element.clientHeight,
      MIN_ZOOM,
      1,
      list.length > 1 ? 0.3 : 0.12,
    );
    void rf.setViewport(viewport, {
      duration: duration({ x: cx, y: cy }),
      ease: easeOut,
      interpolate: 'smooth',
    });
  },
  /** Pan just enough to bring a node on screen, without changing zoom. */
  reveal(id: Id): void {
    const box = display.get(id);
    if (!rf || !element || !box) return;
    const v = this.visibleRect();
    const margin = 40 / this.viewport().zoom;
    const inside =
      box.ax >= v.x + margin &&
      box.ay >= v.y + margin &&
      box.ax + box.w <= v.x + v.w - margin &&
      box.ay + box.h <= v.y + v.h - margin;
    if (inside) return;
    atFit = false;
    const cx = box.ax + box.w / 2;
    const cy = box.ay + box.h / 2;
    void rf.setCenter(cx, cy, {
      zoom: this.viewport().zoom,
      duration: reducedMotion() ? 0 : 250,
      ease: easeOut,
    });
  },
  zoomBy(factor: number): void {
    if (!rf) return;
    atFit = false;
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, rf.getViewport().zoom * factor));
    void rf.zoomTo(z, { duration: reducedMotion() ? 0 : 160 });
  },
  panBy(dx: number, dy: number): void {
    if (!rf) return;
    atFit = false;
    const vp = rf.getViewport();
    void rf.setViewport({ ...vp, x: vp.x + dx, y: vp.y + dy }, { duration: reducedMotion() ? 0 : 120 });
  },
  back(current: Id | null): Entry | null {
    const entry = past.pop();
    if (!rf || !entry) return null;
    atFit = false;
    future.push({ viewport: rf.getViewport(), selectedId: current });
    void rf.setViewport(entry.viewport, {
      duration: reducedMotion() ? 0 : 350,
      ease: easeOut,
      interpolate: 'smooth',
    });
    return entry;
  },
  forward(current: Id | null): Entry | null {
    const entry = future.pop();
    if (!rf || !entry) return null;
    atFit = false;
    past.push({ viewport: rf.getViewport(), selectedId: current });
    void rf.setViewport(entry.viewport, {
      duration: reducedMotion() ? 0 : 350,
      ease: easeOut,
      interpolate: 'smooth',
    });
    return entry;
  },
};
