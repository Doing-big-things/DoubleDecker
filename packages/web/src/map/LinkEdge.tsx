import {
  chipLabel,
  type DeckIndex,
  type FindingKind,
  type Id,
  type Link,
  linkTests,
  testStats,
} from '@decker/deck-model';
import { type EdgeProps, useInternalNode } from '@xyflow/react';
import { createContext, memo, useContext } from 'react';
import { createPortal } from 'react-dom';
import { linkMark, pendingInLink } from '../model/pending';
import { currentRun, type DeckState, useDeck, useLevel } from '../state/store';
import { StateBadge } from './BlockNode';
import { BANDS, camera } from './camera';
import { type Rect, route } from './geometry';

/**
 * The layer arrow labels are drawn in: inside the viewport, above the lines. React Flow's own
 * label renderer looks this element up again on every camera frame, once per label.
 */
export const LabelLayer = createContext<Element | null>(null);

const areaLinkCache = new WeakMap<DeckIndex, Map<string, Link>>();

export function linkOf(index: DeckIndex, id: string): Link | undefined {
  const direct = index.linkById.get(id);
  if (direct) return direct;
  let map = areaLinkCache.get(index);
  if (!map) {
    map = new Map(index.areaLinks.map((l) => [l.id, l]));
    areaLinkCache.set(index, map);
  }
  return map.get(id);
}

const RANK: Record<string, number> = {
  contradicted: 0,
  unrequested: 1,
  missing: 2,
  implemented: 4,
  supported: 5,
  untested: 6,
};

/** The state an arrow is drawn in: a review finding first, then a pending request. */
export function linkState(s: Pick<DeckState, 'marks' | 'findings'>, link: Link): string | undefined {
  if (s.findings.size) {
    let best: FindingKind | undefined = s.findings.get(link.id);
    for (const e of link.edges) {
      const f = s.findings.get(e.id);
      if (f && (!best || RANK[f]! < RANK[best]!)) best = f;
    }
    if (best && best !== 'supported' && best !== 'untested') return best;
  }
  return linkMark(link, s.marks)?.state;
}

function rectOf(node: ReturnType<typeof useInternalNode>): Rect | null {
  if (!node) return null;
  const w = node.measured.width ?? node.width ?? 0;
  const h = node.measured.height ?? node.height ?? 0;
  return { x: node.internals.positionAbsolute.x, y: node.internals.positionAbsolute.y, w, h };
}

export const LinkEdge = memo(function LinkEdge({ id, source, target, data }: EdgeProps) {
  const level = useLevel();
  const labels = useContext(LabelLayer);
  const a = rectOf(useInternalNode(source));
  const b = rectOf(useInternalNode(target));
  const link = useDeck((s) => (s.index ? linkOf(s.index, id) : undefined));
  const band = useDeck((s) => s.band);
  const selected = useDeck((s) => s.selectedId === id);
  const near = useDeck((s) => s.selectedId !== null && (s.selectedId === source || s.selectedId === target));
  const lit = useDeck((s) => s.lit?.has(id) ?? false);
  const dim = useDeck((s) => s.lit !== null && !s.lit.has(id));
  const state = useDeck((s) => (link ? linkState(s, link) : undefined));
  const pending = useDeck((s) => (link ? pendingInLink(link, s.marks) : 0));
  // The tests a change linked to this arrow's requirements, as "state|label". Empty for most arrows.
  const tests = useDeck((s) => {
    if (!link || !s.index || !link.edges.some((e) => e.tests)) return '';
    const stats = testStats(linkTests(s.index, link), currentRun(s));
    return stats.total ? `${stats.state}|${chipLabel(stats)}` : '';
  });
  const unchanged = useDeck(
    (s) =>
      s.changedIds !== null &&
      link !== undefined &&
      !s.changedIds.has(id) &&
      !link.edges.some((e) => s.changedIds!.has(e.id)),
  );

  if (!a || !b || !link) return null;
  const scale = Math.max(1, 0.9 / BANDS[band]!);
  const slots = (data ?? {}) as { s?: number; t?: number; r?: number };
  const geo = route(a, b, slots.s ?? 0.5, slots.t ?? 0.5, scale, slots.r ?? 0);
  const width = (1.5 + Math.min(2.5, (link.count - 1) * (level === 'system' ? 0.12 : 0.5))) * scale;
  const dash = state === 'requested' || state === 'missing' ? `${6 * scale} ${5 * scale}` : undefined;
  const allIndirect = link.edges.every((e) => e.indirect);
  const label = link.label ?? (allIndirect ? link.indirect : undefined);
  const showPill =
    level === 'system' ||
    selected ||
    lit ||
    Boolean(state) ||
    pending > 0 ||
    (level === 'blocks' && Boolean(label)) ||
    (level === 'blocks' && near && link.count > 1);

  // A label never hides under a card: it slides along its run to a clear spot, and a label
  // that only names the arrow's kind is left out when there is none.
  let labelX = geo.labelX;
  let pill = showPill;
  if (showPill && level !== 'system') {
    const hw = ((label?.length ?? 4) * 3.3 + 22) * scale;
    const hh = 13 * scale;
    const clear = (x: number, y: number) => !camera.coversBlock(x - hw, y - hh, x + hw, y + hh);
    if (!clear(labelX, geo.labelY)) {
      const run = geo.slide;
      const spot = run
        ? [0.5, 0.3, 0.7, 0.15, 0.85].map((f) => run.x0 + (run.x1 - run.x0) * f).find((x) => clear(x, run.y))
        : undefined;
      if (spot !== undefined) labelX = spot;
      else if (!selected && !state && pending === 0) pill = false;
    }
  }

  const cls = [
    'dd-edge',
    selected ? 'is-selected' : '',
    lit || near ? 'is-lit' : '',
    dim ? 'dd-dim' : '',
    unchanged ? 'dd-unchanged' : '',
  ].join(' ');
  return (
    <>
      <g className={cls} data-s={state} data-testid="arrow" data-id={id} data-from={source} data-to={target}>
        {geo.parts.map((part, i) => (
          <path
            key={i}
            className="dd-edge-line"
            d={part}
            style={{ strokeWidth: width, strokeDasharray: dash }}
          />
        ))}
        <path className="dd-edge-head" d={geo.head} />
        <path
          d={geo.d}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(16, 14 * scale)}
          className="react-flow__edge-interaction"
        />
      </g>
      {pill && labels
        ? createPortal(
            <button
              type="button"
              className={`dd-edge-pill nodrag nopan${selected ? ' is-selected' : lit || near ? ' is-lit' : ''}${state === 'removed' ? ' is-struck' : ''}${dim ? ' dd-dim' : ''}${unchanged ? ' dd-unchanged' : ''}`}
              style={{ left: labelX, top: geo.labelY }}
              data-testid="arrow-pill"
              onClick={(e) => {
                e.stopPropagation();
                useDeck.getState().select(id);
              }}
              onMouseEnter={() => useDeck.getState().hover(id)}
              onMouseLeave={() => useDeck.getState().hover(null)}
            >
              {label ? (
                <span>{label}</span>
              ) : level !== 'system' && !state && link.count === 1 ? (
                <span>call</span>
              ) : null}
              {link.count > 1 || level === 'system' ? (
                <span className="dd-edge-count">
                  {level === 'system' && !label ? link.count : `×${link.count}`}
                </span>
              ) : null}
              {tests && level === 'blocks' ? (
                <span
                  className="dd-chip"
                  data-s={tests.split('|')[0]}
                  data-testid="arrow-tests"
                  title="Tests linked to this arrow's requirements"
                >
                  {tests.split('|')[1]}
                </span>
              ) : null}
              <StateBadge state={state} />
              {pending > 0 ? (
                <span className="dd-badge" data-s="requested">
                  +{pending} requested
                </span>
              ) : null}
            </button>,
            labels,
          )
        : null}
    </>
  );
});

export type { Id };
