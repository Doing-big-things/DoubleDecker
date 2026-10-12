// A connection of the simple view (spec §3.13): one line between two parts, with what the
// first asks of the second written on it. The path and the label's place come from the layout,
// which routes every line around the cards and leaves room for its words.
//
// A line says which way it goes at both ends. It leaves through a ring in the asking part's
// color, and it arrives in a disc whose chevron points into the part that is asked.
import type { EdgeProps } from '@xyflow/react';
import { memo, useContext } from 'react';
import { createPortal } from 'react-dom';
import { linkRequested } from '../model/simple';
import { useDeck } from '../state/store';
import { areaStyle, LOOSE_HUE } from './AreaNode';
import { StateBadge } from './BlockNode';
import { BANDS, ZOOM_STEPS } from './camera';
import { rounded } from './geometry';
import { LabelLayer } from './LinkEdge';
import { partScale } from './PartNode';

/** The box the marks at a line's two ends are drawn in, in px at 100% zoom. */
export const END_SIZE = 24;

export const PlainEdge = memo(function PlainEdge({ id, source, target }: EdgeProps) {
  const labels = useContext(LabelLayer);
  const link = useDeck((s) => s.simple?.linkById.get(id));
  const path = useDeck((s) => s.simpleLayout?.routes.get(id));
  const band = useDeck((s) => s.band);
  const step = useDeck((s) => s.zoomStep);
  const hue = useDeck((s) =>
    s.index && s.simple?.partById.get(source)?.node.kind === 'area'
      ? areaStyle(s.index, source).hue
      : LOOSE_HUE,
  );
  const look = useDeck((s) => {
    if (!link) return '';
    const sel = s.selectedId;
    return [
      sel === id ? 1 : 0,
      sel !== null && (sel === source || sel === target) ? 1 : 0,
      s.lit?.has(id) ? 1 : 0,
      s.lit !== null && !s.lit.has(id) ? 1 : 0,
      s.simpleChanged !== null && !s.simpleChanged.has(id) ? 1 : 0,
      linkRequested(link, s.marks),
      s.simpleState.get(id) ?? '',
    ].join('\u0001');
  });
  if (!link || !path || path.points.length < 2) return null;
  const part = look.split('\u0001');
  const selected = part[0] === '1';
  const near = part[1] === '1';
  const lit = part[2] === '1';
  const dim = part[3] === '1';
  const unchanged = part[4] === '1';
  const requested = part[5] as 'all' | 'some' | 'none';
  const state = part[6] || (requested === 'all' ? 'requested' : undefined);

  const scale = Math.max(1, 0.9 / BANDS[band]!);
  const points = path.points;
  const [sx, sy] = points[0]!;
  const [ex, ey] = points.at(-1)!;
  const [px, py] = points.at(-2)!;
  const heading = (Math.atan2(ey - py, ex - px) * 180) / Math.PI;
  const line = rounded(points, 12 * Math.min(scale, 3));
  const dash = state === 'requested' || state === 'missing' ? `${7 * scale} ${7 * scale}` : undefined;
  // A little way out the words are drawn larger to stay readable, in the width the layout
  // kept for them: they take more lines, not more room. Further out they would cover the
  // picture, so they wait for a hover or a click.
  const readable = step / ZOOM_STEPS >= 0.44;
  const showLabel = path.label && (readable || selected || lit || near);
  const grow = partScale(step);

  const on = selected ? ' is-selected' : lit || near ? ' is-lit' : '';
  const faded = `${dim ? ' dd-dim' : ''}${unchanged ? ' dd-unchanged' : ''}`;
  const end = END_SIZE * scale;
  return (
    <>
      <g
        className={`dd-edge dd-plain${on}${faded}`}
        data-s={state}
        data-testid="connection"
        data-id={id}
        data-from={source}
        data-to={target}
      >
        <path className="dd-edge-line" d={line.d} style={{ strokeWidth: 2 * scale, strokeDasharray: dash }} />
        <path
          d={line.d}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(18, 16 * scale)}
          className="react-flow__edge-interaction"
        />
      </g>
      {labels
        ? createPortal(
            <>
              <svg
                className={`dd-end dd-end-from${on}${faded}`}
                viewBox="-12 -12 24 24"
                style={{ left: sx, top: sy, width: end, height: end, '--h': hue } as React.CSSProperties}
                data-s={state}
                data-testid="connection-from"
                data-id={id}
                aria-hidden="true"
              >
                <circle className="dd-end-ring" r="7.5" />
                <circle className="dd-end-dot" r="3" />
              </svg>
              <svg
                className={`dd-end dd-end-to${on}${faded}`}
                viewBox="-12 -12 24 24"
                style={{ left: ex, top: ey, width: end, height: end }}
                data-s={state}
                data-testid="connection-to"
                data-id={id}
                aria-hidden="true"
              >
                <circle className="dd-end-disc" r="10.5" />
                <path className="dd-end-chev" d="M-2.6,-5L2.6,0L-2.6,5" transform={`rotate(${heading})`} />
              </svg>
              {showLabel ? (
                <button
                  type="button"
                  className={`dd-plain-label nodrag nopan${on}${faded}`}
                  style={{
                    left: path.label!.x + path.label!.w / 2,
                    top: path.label!.y + path.label!.h / 2,
                    width: path.label!.w,
                    fontSize: grow === 1 ? undefined : 14.5 * grow,
                    lineHeight: grow === 1 ? undefined : `${20 * grow}px`,
                  }}
                  data-s={state}
                  data-testid="connection-label"
                  data-id={id}
                  title={state === 'requested' ? `${link.label.text}  (requested, not built yet)` : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    useDeck.getState().select(id);
                  }}
                  onMouseEnter={() => useDeck.getState().hover(id)}
                  onMouseLeave={() => useDeck.getState().hover(null)}
                >
                  <span>{link.label.text}</span>
                  {state && state !== 'requested' ? (
                    <span className="dd-plain-flag">
                      <StateBadge state={state} />
                    </span>
                  ) : requested === 'some' ? (
                    <span className="dd-plain-flag">
                      <span className="dd-badge" data-s="requested">
                        + requested
                      </span>
                    </span>
                  ) : null}
                </button>
              ) : null}
            </>,
            labels,
          )
        : null}
    </>
  );
});
