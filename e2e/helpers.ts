import { expect, type Locator, type Page } from '@playwright/test';

export type Level = 'system' | 'architecture' | 'blocks';

export const canvas = (page: Page): Locator => page.getByTestId('canvas');
export const block = (page: Page, name: string): Locator =>
  page.locator(`[data-testid="block"][data-name="${name}"]`);
export const arrow = (page: Page, from: string, to: string): Locator =>
  page.locator(`[data-testid="arrow"][data-from="${from}"][data-to="${to}"]`);

export async function ready(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="app"][data-status="ready"]', { timeout: 30_000 });
  await expect(page.locator('.dd-loading')).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(() => page.locator('.react-flow__node').count()).toBeGreaterThan(0);
  await page.waitForTimeout(400);
}

export async function openFixture(page: Page, name = 'shop'): Promise<void> {
  await page.goto(`/?fixture=${name}`);
  await ready(page);
}

export const zoom = (page: Page): Promise<number> =>
  page.evaluate(() => window.__decker.camera.viewport().zoom);

/** Zoom with the mouse wheel, at a point, until the map reaches a level. */
export async function wheelTo(page: Page, level: Level, at?: { x: number; y: number }): Promise<void> {
  const box = (await canvas(page).boundingBox())!;
  const point = at ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const order: Level[] = ['system', 'architecture', 'blocks'];
  await page.mouse.move(point.x, point.y);
  for (let i = 0; i < 40; i++) {
    const now = (await canvas(page).getAttribute('data-level')) as Level;
    if (now === level) return;
    await page.mouse.wheel(0, order.indexOf(now) < order.indexOf(level) ? -160 : 160);
    await page.waitForTimeout(60);
  }
  throw new Error(`never reached the ${level} level`);
}

/** Set an exact zoom through the camera, keeping the view centred. */
export async function setZoom(page: Page, value: number): Promise<void> {
  await page.evaluate((z) => {
    const cam = window.__decker.camera;
    cam.zoomBy(z / cam.viewport().zoom);
  }, value);
  await expect.poll(() => zoom(page), { timeout: 5000 }).toBeCloseTo(value, 2);
  await page.waitForTimeout(250);
}

/** Search and fly: Ctrl+K, type, Enter. */
export async function flyTo(page: Page, query: string): Promise<void> {
  await page.keyboard.press('Control+k');
  await page.getByTestId('palette').locator('input').fill(query);
  await expect(page.getByTestId('palette-item').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('palette')).toHaveCount(0);
  await page.waitForTimeout(700);
}

/** Every piece of text on the canvas, with its size on screen. Returns the ones under 11 px. */
export async function smallText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const z = window.__decker.camera.viewport().zoom;
    const root = document.querySelector('.react-flow__viewport');
    const out: string[] = [];
    if (!root) return out;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent?.trim();
      const el = walker.currentNode.parentElement;
      if (!text || !el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      let hidden = false;
      for (let a: HTMLElement | null = el; a && a !== root; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') hidden = true;
      }
      if (hidden) continue;
      const px = Number.parseFloat(getComputedStyle(el).fontSize) * z;
      if (px < 10.9) out.push(`"${text.slice(0, 28)}" at ${px.toFixed(1)} px (zoom ${z.toFixed(2)})`);
    }
    return [...new Set(out)];
  });
}

/**
 * Frame times while an action runs: the 95th percentile and the median in frames per second,
 * and the longest single frame in milliseconds.
 */
export async function measureFps(
  page: Page,
  action: () => Promise<void>,
): Promise<{ p95: number; median: number; frames: number; worst: number }> {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __raf: number };
    w.__frames = [];
    let last = performance.now();
    const tick = (now: number) => {
      w.__frames.push(now - last);
      last = now;
      w.__raf = requestAnimationFrame(tick);
    };
    w.__raf = requestAnimationFrame(tick);
  });
  await action();
  return page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __raf: number };
    cancelAnimationFrame(w.__raf);
    const sorted = [...w.__frames].slice(2).sort((a, b) => a - b);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 16;
    return {
      p95: Math.round(1000 / at(0.95)),
      median: Math.round(1000 / at(0.5)),
      frames: sorted.length,
      worst: Math.round(sorted.at(-1) ?? 0),
    };
  });
}
