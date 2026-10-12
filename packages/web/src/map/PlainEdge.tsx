// A connection of the simple view (spec §3.13): one line between two parts, with what the
// first asks of the second written on it. The path and the label's place come from the layout,
// which routes every line around the cards and leaves room for its words.
import type { EdgeProps } from '@xyflow/react';
import { memo, useContext } from 'react';
import { createPortal } from 'react-dom';
import { linkRequested } from '../model/simple';
import { useDeck } from '../state/store';
import { StateBadge } from './BlockNode';
import { BANDS, ZOOM_STEPS } from './camera';
import { rounded } from './geometry';
import { LabelLayer } from './LinkEdge';
import { partScale } from './PartNode';

export const PlainEdge = memo(function PlainEdge({ id, source, target }: EdgeProps) {
  const labels = useContext(LabelLayer);
  const link = useDeck((s) => s.simple?.linkById.get(id));
  const path = useDeck((s) => s.simpleLayout?.routes.get(id));
  const band = useDeck((s) => s.band);
  const step = useDeck((s) => s.zoomStep);
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
  const [ex, ey] = points.at(-1)!;
  const [px, py] = points.at(-2)!;
  const len = Math.hypot(ex - px, ey - py) || 1;
  const ux = (ex - px) / len;
  const uy = (ey - py) / len;
  const hl = 8 * scale;
  const hw = 4.5 * scale;
  // The line stops inside the arrowhead, so its square end never shows past the tip.
  const line = rounded(
    [...points.slice(0, -1), [ex - ux * hl * 0.7, ey - uy * hl * 0.7]],
    10 * Math.min(scale, 3),
  );
  const head = `M${ex - ux * hl - uy * hw},${ey - uy * hl + ux * hw}L${ex - ux * hl + uy * hw},${ey - uy * hl - ux * hw}L${ex},${ey}Z`;
  const dash = state === 'requested' || state === 'missing' ? `${7 * scale} ${6 * scale}` : undefined;
  // A little way out the words are drawn larger to stay readable, in the width the layout
  // kept for them: they take more lines, not more room. Further out they would cover the
  // picture, so they wait for a hover or a click.
  const readable = step / ZOOM_STEPS >= 0.44;
  const showLabel = path.label && (readable || selected || lit || near);
  const grow = partScale(step);

  const cls = [
    'dd-edge dd-plain',
    selected ? 'is-selected' : '',
    lit || near ? 'is-lit' : '',
    dim ? 'dd-dim' : '',
    unchanged ? 'dd-unchanged' : '',
  ].join(' ');
  return (
    <>
      <g
        className={cls}
        data-s={state}
        data-testid="connection"
        data-id={id}
        data-from={source}
        data-to={target}
      >
        {line.parts.map((d, i) => (
          <path
            key={i}
            className="dd-edge-line"
            d={d}
            style={{ strokeWidth: 2 * scale, strokeDasharray: dash }}
          />
        ))}
        <path className="dd-edge-head" d={head} />
        <path
          d={line.d}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(18, 16 * scale)}
          className="react-flow__edge-interaction"
        />
      </g>
      {showLabel && labels
        ? createPortal(
            <button
              type="button"
              className={`dd-plain-label nodrag nopan${selected ? ' is-selected' : lit || near ? ' is-lit' : ''}${dim ? ' dd-dim' : ''}${unchanged ? ' dd-unchanged' : ''}`}
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
            </button>,
            labels,
          )
        : null}
    </>
  );
});
