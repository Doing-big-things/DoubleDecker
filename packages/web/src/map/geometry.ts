// Arrow geometry. Arrows attach to the top and bottom of blocks and run orthogonally
// with rounded corners; side by side blocks connect through their sides.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Side = 'down' | 'up' | 'right' | 'left';

/** Which way an arrow leaves `a` to reach `b`. */
export function sideOf(a: Rect, b: Rect): Side {
  if (b.y - (a.y + a.h) >= 16) return 'down';
  // Not below: go sideways when there is room between them, and only climb when stacked.
  if (b.x - (a.x + a.w) >= 16) return 'right';
  if (a.x - (b.x + b.w) >= 16) return 'left';
  if (a.y - (b.y + b.h) >= 16) return 'up';
  return b.x + b.w / 2 >= a.x + a.w / 2 ? 'right' : 'left';
}

export interface Route {
  d: string;
  head: string;
  labelX: number;
  labelY: number;
}

function rounded(points: [number, number][], radius: number): string {
  if (points.length < 3) return `M${points.map((p) => `${p[0]},${p[1]}`).join('L')}`;
  let d = `M${points[0]![0]},${points[0]![1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1]!;
    const [cx, cy] = points[i]!;
    const [nx, ny] = points[i + 1]!;
    const inLen = Math.hypot(cx - px, cy - py);
    const outLen = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r < 0.5) {
      d += `L${cx},${cy}`;
      continue;
    }
    const ax = cx - ((cx - px) / inLen) * r;
    const ay = cy - ((cy - py) / inLen) * r;
    const bx = cx + ((nx - cx) / outLen) * r;
    const by = cy + ((ny - cy) / outLen) * r;
    d += `L${ax},${ay}Q${cx},${cy} ${bx},${by}`;
  }
  const last = points.at(-1)!;
  return `${d}L${last[0]},${last[1]}`;
}

/**
 * Route an arrow from `a` to `b`. `sf` and `tf` are where along the side it attaches (0 to 1),
 * `scale` keeps line weight and arrowheads legible when zoomed out.
 */
export function route(a: Rect, b: Rect, sf: number, tf: number, scale: number, rank = 0): Route {
  const side = sideOf(a, b);
  const hl = 7 * scale; // arrowhead length
  const hw = 4 * scale; // half its width
  const r = 8 * Math.min(scale, 3);

  if (side === 'down' || side === 'up') {
    const dir = side === 'down' ? 1 : -1;
    const sx = a.x + a.w * sf;
    const sy = side === 'down' ? a.y + a.h : a.y;
    const ex = b.x + b.w * tf;
    const ey = side === 'down' ? b.y : b.y + b.h;
    const gap = Math.abs(ey - sy);
    const lane = ey - dir * Math.min(gap / 2, 18 * Math.min(scale, 2.5));
    const tip = ey - dir * hl * 0.7;
    const d =
      Math.abs(ex - sx) < 1
        ? `M${sx},${sy}L${ex},${tip}`
        : rounded(
            [
              [sx, sy],
              [sx, lane],
              [ex, lane],
              [ex, tip],
            ],
            r,
          );
    const head = `M${ex - hw},${ey - dir * hl}L${ex + hw},${ey - dir * hl}L${ex},${ey}Z`;
    // Labels sit on the last horizontal run, near the block they point at, and fan out
    // along it so arrows that arrive together do not stack their labels.
    const run = Math.abs(ex - sx);
    if (run < 1) return { d, head, labelX: ex, labelY: (sy + ey) / 2 };
    const want = (64 + rank * 124) * scale;
    const labelX = want > run - 28 * scale ? (sx + ex) / 2 : ex - Math.sign(ex - sx) * want;
    return { d, head, labelX, labelY: lane };
  }

  const dir = side === 'right' ? 1 : -1;
  const sx = side === 'right' ? a.x + a.w : a.x;
  const ex = side === 'right' ? b.x : b.x + b.w;
  const sy = a.y + Math.min(a.h / 2, 40) + (sf - 0.5) * 24;
  const ey = b.y + Math.min(b.h / 2, 40) + (tf - 0.5) * 24;
  const tip = ex - dir * hl * 0.7;
  const head = `M${ex - dir * hl},${ey - hw}L${ex - dir * hl},${ey + hw}L${ex},${ey}Z`;
  if ((ex - sx) * dir < 12) {
    // Overlapping boxes: a short hop around the outside.
    const out = Math.max(a.y + a.h, b.y + b.h) + 18 * scale;
    const d = rounded(
      [
        [a.x + a.w / 2, a.y + a.h],
        [a.x + a.w / 2, out],
        [b.x + b.w / 2, out],
        [b.x + b.w / 2, b.y + b.h + hl * 0.7],
      ],
      r,
    );
    const bx = b.x + b.w / 2;
    return {
      d,
      head: `M${bx - hw},${b.y + b.h + hl}L${bx + hw},${b.y + b.h + hl}L${bx},${b.y + b.h}Z`,
      labelX: (a.x + a.w / 2 + bx) / 2,
      labelY: out,
    };
  }
  const mid = (sx + ex) / 2;
  const d =
    Math.abs(ey - sy) < 1
      ? `M${sx},${sy}L${tip},${ey}`
      : rounded(
          [
            [sx, sy],
            [mid, sy],
            [mid, ey],
            [tip, ey],
          ],
          r,
        );
  return { d, head, labelX: mid, labelY: (sy + ey) / 2 };
}

/** Spread k arrows along one side: fractions centered on 0.5. */
export function slot(i: number, k: number): number {
  if (k <= 1) return 0.5;
  const span = Math.min(0.64, 0.16 * (k - 1));
  return 0.5 - span / 2 + (span * i) / (k - 1);
}
