import { blocksUnder, type DeckIndex, fnv1a, type Id, testStats } from '@decker/deck-model';
import type { NodeProps } from '@xyflow/react';
import { createContext, memo, useContext, useMemo } from 'react';
import { areaExternals } from '../model/layout';
import { currentRun, useDeck, useLevel } from '../state/store';
import { BANDS, camera } from './camera';

/** At System level blocks are not nodes: each area draws its blocks as plain chips. */
export const ChipContext = createContext<Map<Id, { ok: string; fail: string }>>(new Map());

// A fixed palette of hues, assigned by area name: blue, violet, teal, lime, pink, sky, green
// and orchid. They are OKLCH hues, and the stylesheet gives every one the same lightness and
// strength, so the areas differ in color and never in loudness. None is amber or red: on the
// map those two mean "asked for" and "contradicted", and an area must not look like either.
const HUES = [258, 302, 192, 128, 350, 226, 160, 324];
/** The color of something that belongs to no area. */
export const LOOSE_HUE = 258;
const hueCache = new WeakMap<DeckIndex, Map<Id, { hue: number; depth: number }>>();

export function areaStyle(index: DeckIndex, id: Id): { hue: number; depth: number } {
  let map = hueCache.get(index);
  if (!map) {
    map = new Map();
    hueCache.set(index, map);
    const top = (index.children.get(index.system.id) ?? []).filter((n) => n.kind === 'area');
    const used = new Set<number>();
    const walk = (areaId: Id, hue: number, depth: number) => {
      map!.set(areaId, { hue, depth });
      for (const kid of index.children.get(areaId) ?? [])
        if (kid.kind === 'area') walk(kid.id, hue, depth + 1);
    };
    for (const area of top) {
      let slot = Number.parseInt(fnv1a(area.name).slice(0, 4), 16) % HUES.length;
      for (let i = 0; i < HUES.length && used.has(slot); i++) slot = (slot + 1) % HUES.length;
      used.add(slot);
      if (used.size === HUES.length) used.clear();
      walk(area.id, HUES[slot]!, 0);
    }
  }
  return map.get(id) ?? { hue: LOOSE_HUE, depth: 0 };
}

export const AreaNode = memo(function AreaNode({ id, width, height }: NodeProps) {
  const level = useLevel();
  const index = useDeck((s) => s.index);
  const selected = useDeck((s) => s.selectedId === id);
  const drop = useDeck((s) => s.dropArea === id);
  const dim = useDeck((s) => level === 'system' && s.lit !== null && !s.lit.has(id));
  const band = useDeck((s) => (level === 'system' ? s.band : -1));
  const run = useDeck(currentRun);
  const litExt = useDeck((s) => (s.hoverId?.startsWith(`ext:${id}:`) ? s.hoverId : null));
  const chips = useContext(ChipContext).get(id);

  const info = useMemo(() => {
    if (!index) return null;
    const blocks = blocksUnder(index, id);
    const tests = new Set(blocks.flatMap((b) => index.testsOf.get(b.id) ?? []));
    return {
      blocks: blocks.length,
      stats: testStats([...tests], run),
      externals: areaExternals(index, id),
      nested: (index.children.get(id) ?? []).some((k) => k.kind === 'area'),
    };
  }, [index, id, run]);

  const area = index?.byId.get(id);
  if (!index || !area || !info) return null;
  const { hue, depth } = areaStyle(index, id);
  const w = width ?? 0;
  const h = height ?? 0;

  // At System level every area is labelled across its middle, like a region on a map,
  // sized to stay legible and to fit. Top-level areas also carry their counts.
  const lower = band >= 0 ? BANDS[band]! : 1;
  const centered = level === 'system';
  const want = (depth === 0 ? 15 : 11.5) / lower;
  const centerFs = Math.max(11 / lower, Math.min(want, (w * 0.86) / (area.name.length * 0.6 + 1)));
  const centerFits =
    centered &&
    (depth === 0
      ? centerFs * lower >= 10.95 && h * lower >= 20
      : centerFs * lower >= 10.5 &&
        w * lower >= Math.max(110, area.name.length * 6.6 + 30) &&
        h * lower >= 56);
  const meta = `${info.blocks} block${info.blocks === 1 ? '' : 's'}${info.stats.total ? ` · ${info.stats.total} tests` : ''}`;
  const metaFits =
    depth === 0 &&
    (meta.length + (info.stats.failed ? 5 : 0)) * centerFs * 0.75 * 0.52 <= w * 0.9 &&
    h * lower >= 44;

  return (
    <div
      role="group"
      className={`dd-area${selected ? ' is-selected' : ''}${drop ? ' is-drop' : ''}${dim ? ' dd-dim' : ''}`}
      style={{ '--h': hue } as React.CSSProperties}
      data-depth={Math.min(depth, 1)}
      data-testid="area"
      data-id={id}
      data-name={area.name}
      aria-label={`${area.name}, area, ${info.blocks} blocks`}
      onDoubleClick={(e) => {
        if (level === 'system' || (e.target as HTMLElement).closest('.dd-area-title')) return;
        e.stopPropagation();
        const flow = camera.toFlow(e.clientX, e.clientY);
        const box = camera.box(id);
        if (!box) return;
        const snap = (v: number) => Math.round(v / 8) * 8;
        useDeck.getState().set({
          popover: {
            kind: 'block',
            parentId: id,
            x: e.clientX,
            y: e.clientY,
            position: { x: snap(flow.x - box.ax - 140), y: snap(flow.y - box.ay - 20) },
          },
        });
      }}
    >
      {chips ? (
        <svg className="dd-chips dd-lod" aria-hidden="true">
          <path d={chips.ok} />
          {chips.fail ? <path d={chips.fail} className="is-fail" /> : null}
        </svg>
      ) : null}
      {centered ? (
        centerFits ? (
          <div
            className="dd-area-center dd-lod"
            style={{ fontSize: centerFs }}
            data-top={depth === 0 ? '1' : '0'}
            data-nested={info.nested ? '1' : '0'}
          >
            <div>
              <b data-testid="area-label">{area.name}</b>
              {metaFits ? (
                <span className="dd-area-meta">
                  {meta}
                  {info.stats.failed ? <span className="is-fail"> · ✕{info.stats.failed}</span> : null}
                </span>
              ) : null}
            </div>
          </div>
        ) : null
      ) : null}
      {info.externals.length ? (
        <div className="dd-externals">
          {info.externals.map((ext) => {
            const key = `ext:${id}:${ext.id}`;
            return (
              <span
                key={ext.id}
                className={`dd-ext${litExt === key ? ' is-lit' : ''}`}
                data-testid="external"
                title={`External: ${ext.name}`}
                onMouseEnter={() => useDeck.getState().hover(key)}
                onMouseLeave={() => useDeck.getState().hover(null)}
              >
                {ext.name}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});

/** Area titles for the Architecture and Blocks levels, drawn above the arrows so a line never strikes one out. */
export function AreaTitles({ boxes }: { boxes: { id: Id; x: number; y: number; w: number }[] }) {
  const index = useDeck((s) => s.index);
  const selectedId = useDeck((s) => s.selectedId);
  if (!index) return null;
  return (
    <>
      {boxes.map((box) => {
        const area = index.byId.get(box.id);
        if (!area) return null;
        const { hue } = areaStyle(index, box.id);
        return (
          <button
            key={box.id}
            type="button"
            className={`dd-area-title nodrag nopan${selectedId === box.id ? ' is-selected' : ''}`}
            style={
              { '--h': hue, left: box.x + 14, top: box.y + 9, maxWidth: box.w - 28 } as React.CSSProperties
            }
            data-testid="area-title"
            data-name={area.name}
            onClick={(e) => {
              e.stopPropagation();
              useDeck.getState().select(box.id);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              useDeck.getState().select(box.id, { fly: true });
            }}
          >
            <span>{area.name}</span>
          </button>
        );
      })}
    </>
  );
}
