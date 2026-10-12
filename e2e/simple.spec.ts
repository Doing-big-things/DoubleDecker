// The simple view on the hand-written shop fixture, with no server (spec §3.13).
// It is what the app opens on: a few large parts in plain words, labelled connections, one
// place on each part to ask for something, and the full map one step behind it.
import { expect, type Page, test } from '@playwright/test';
import { block, canvas, measureFps, openFixture, part, ready, setZoom, smallText, zoom } from './helpers';

const toggle = (page: Page) => page.getByTestId('view-toggle');
const label = (page: Page, text: string) => page.getByTestId('connection-label').filter({ hasText: text });
const connection = (page: Page, from: string, to: string) =>
  page.locator(`[data-testid="connection"][data-from="${from}"][data-to="${to}"]`);

/** The id of a part on the page, by name. */
const partId = (page: Page, name: string): Promise<string> =>
  page.evaluate((n) => {
    const hit = window.__decker.store.getState().simple.parts.find((p: { name: string }) => p.name === n);
    if (!hit) throw new Error(`no part named ${n}`);
    return hit.id as string;
  }, name);

/** Where every part sits, in map coordinates. */
const boxes = (page: Page): Promise<Record<string, number[]>> =>
  page.evaluate(() => {
    const st = window.__decker.store.getState();
    const out: Record<string, number[]> = {};
    for (const p of st.simple.parts) {
      const b = st.simpleLayout.boxes.get(p.id);
      out[p.name] = [b.x, b.y, b.w, b.h];
    }
    return out;
  });

const overlaps = (a: DOMRect | { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test.beforeEach(async ({ page }) => {
  // No view is asked for: the simple view is where the app starts.
  await page.goto('/?fixture=shop');
  await ready(page);
});

test('the app opens on a few large parts in plain words, with a labelled connection between any two that talk', async ({
  page,
}) => {
  await expect(toggle(page)).toHaveText('Simple');
  await expect(canvas(page)).toHaveAttribute('data-view', 'simple');

  // Six parts stand for the six top-level areas. No block, no arrow of the full map, no minimap.
  await expect(page.getByTestId('part')).toHaveCount(6);
  for (const name of ['HTTP', 'Orders', 'Inventory', 'Catalog', 'Payments', 'Shared'])
    await expect(part(page, name)).toBeVisible();
  await expect(page.getByTestId('block')).toHaveCount(0);
  await expect(page.getByTestId('arrow')).toHaveCount(0);
  await expect(page.getByTestId('minimap')).toHaveCount(0);

  // Each says what it is for and what it does, without a function name in sight.
  const orders = part(page, 'Orders');
  await expect(orders.getByTestId('part-summary')).toHaveText(
    'Takes a customer from a full cart to a paid order',
  );
  await expect(orders.getByTestId('part-row')).toHaveText([
    'Holds what a customer wants to buy',
    'Works out prices and discounts',
    'Takes payment and confirms the order',
    'Gets paid orders out of the door',
  ]);
  await expect(orders.getByTestId('part-meta')).toContainText('8 blocks');
  expect(await page.getByTestId('part').allInnerTexts()).not.toEqual(
    expect.arrayContaining([expect.stringMatching(/\w+\(|=>|\.ts\b/)]),
  );

  // One connection per pair that talks, each with what is asked written on it.
  await expect(page.getByTestId('connection')).toHaveCount(6);
  const http = await partId(page, 'HTTP');
  const catalog = await partId(page, 'Catalog');
  await expect(connection(page, http, catalog)).toHaveCount(1);
  await expect(label(page, 'gets catalog information')).toBeVisible();
  await expect(label(page, 'charges and refunds customers')).toBeVisible();

  // What every part leans on is common ground: a bar beneath the rest, and no arrows to it.
  const shared = part(page, 'Shared');
  await expect(shared).toHaveClass(/is-bar/);
  await expect(shared.getByTestId('part-used-by')).toHaveText('Used by every other part');
  const sharedId = await partId(page, 'Shared');
  await expect(page.locator(`[data-testid="connection"][data-to="${sharedId}"]`)).toHaveCount(0);
  const bar = (await shared.boundingBox())!;
  for (const name of ['HTTP', 'Orders', 'Inventory', 'Catalog', 'Payments'])
    expect((await part(page, name).boundingBox())!.y + 1).toBeLessThan(bar.y);

  // The whole picture is on screen, clear of the controls, at a size that can be read.
  const stage = (await canvas(page).boundingBox())!;
  const chrome = [(await toggle(page).boundingBox())!, (await page.locator('.dd-controls').boundingBox())!];
  for (const el of await page.getByTestId('part').all()) {
    const b = (await el.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(stage.x);
    expect(b.y).toBeGreaterThanOrEqual(stage.y);
    expect(b.x + b.width).toBeLessThanOrEqual(stage.x + stage.width);
    expect(b.y + b.height).toBeLessThanOrEqual(stage.y + stage.height);
    for (const c of chrome) expect(overlaps(b, c)).toBe(false);
  }
  expect(await zoom(page)).toBeGreaterThan(0.76);
  expect(await zoom(page)).toBeLessThanOrEqual(1);
  // No label lies over a card.
  for (const pill of await page.getByTestId('connection-label').all()) {
    const l = (await pill.boundingBox())!;
    for (const el of await page.getByTestId('part').all())
      expect(overlaps(l, (await el.boundingBox())!)).toBe(false);
  }
});

test('no text in the simple view is drawn smaller than 11 px, and cards give up lines before they give up legibility', async ({
  page,
}) => {
  expect(await smallText(page)).toEqual([]);
  // A little way out: larger text, fewer lines, and a count of what is not shown.
  await setZoom(page, 0.6);
  expect(await smallText(page)).toEqual([]);
  await expect(part(page, 'Orders')).toHaveAttribute('data-lod', 'scaled');
  await expect(part(page, 'Orders').getByTestId('part-summary')).toBeVisible();
  expect(await part(page, 'Orders').getByTestId('part-row').count()).toBeLessThan(4);
  await expect(part(page, 'Orders').locator('.dd-part-more')).toHaveText(/^\+\d more$/);
  await expect(part(page, 'Orders').getByTestId('part-ask')).toHaveCount(0);
  await expect(label(page, 'gets catalog information')).toBeVisible();
  // Nothing on a card spills out of it.
  for (const z of [0.6, 0.5, 0.46]) {
    await setZoom(page, z);
    expect(await smallText(page)).toEqual([]);
    const spill = await page.evaluate(() =>
      [...document.querySelectorAll('.dd-part-body')].map((el) => el.scrollHeight - el.clientHeight),
    );
    expect(Math.max(...spill)).toBeLessThanOrEqual(1);
  }
  // Far out: names only, and still nothing too small to read.
  for (const z of [0.4, 0.25, 0.12]) {
    await setZoom(page, z);
    expect(await smallText(page)).toEqual([]);
    await expect(part(page, 'Orders')).toHaveAttribute('data-lod', 'name');
    await expect(part(page, 'Orders').getByTestId('part-name')).toBeVisible();
  }
  // Labels wait for a hover out here.
  await expect(page.getByTestId('connection-label')).toHaveCount(0);
});

test('the toggle sits at the top right of the canvas, shows one word, and each view keeps its place', async ({
  page,
}) => {
  // Top right, a little in from both edges.
  const stage = (await canvas(page).boundingBox())!;
  const at = (await toggle(page).boundingBox())!;
  const fromTop = at.y - stage.y;
  const fromRight = stage.x + stage.width - (at.x + at.width);
  expect(fromTop).toBeGreaterThanOrEqual(8);
  expect(fromTop).toBeLessThanOrEqual(24);
  expect(fromRight).toBeGreaterThanOrEqual(8);
  expect(fromRight).toBeLessThanOrEqual(24);

  // One word, and pressing it goes to the other view: the full map, as it was before.
  await toggle(page).click();
  await expect(toggle(page)).toHaveText('Advanced');
  await expect(canvas(page)).toHaveAttribute('data-view', 'advanced');
  await expect(page.getByTestId('block')).toHaveCount(42);
  await expect(page.getByTestId('part')).toHaveCount(0);
  await expect(page.getByTestId('minimap')).toBeVisible();
  await expect(page.getByTestId('level')).toContainText('Architecture');
  // The toggle has not moved.
  expect((await toggle(page).boundingBox())!.x + (await toggle(page).boundingBox())!.width).toBeCloseTo(
    at.x + at.width,
    0,
  );

  // Move about in the advanced view, go back to simple, and return: it is where it was left.
  await page.waitForTimeout(500);
  await setZoom(page, 0.9);
  const left = await page.evaluate(() => window.__decker.camera.viewport());
  await page.keyboard.press('s');
  await expect(toggle(page)).toHaveText('Simple');
  await expect(page.getByTestId('part')).toHaveCount(6);
  await expect(page.getByTestId('level')).toContainText('Simple');
  await page.waitForTimeout(500);
  expect(await zoom(page)).not.toBeCloseTo(0.9, 1);
  await page.keyboard.press('s');
  await expect(toggle(page)).toHaveText('Advanced');
  await page.waitForTimeout(600);
  const back = await page.evaluate(() => window.__decker.camera.viewport());
  expect(back.zoom).toBeCloseTo(left.zoom, 2);
  expect(back.x).toBeCloseTo(left.x, 0);

  // The choice is remembered.
  await page.reload();
  await ready(page);
  await expect(toggle(page)).toHaveText('Advanced');
  await toggle(page).click();
  await page.reload();
  await ready(page);
  await expect(toggle(page)).toHaveText('Simple');
  await expect(page.getByTestId('part')).toHaveCount(6);
});

test('a part opens onto its area in the advanced view, and anything the simple view does not show takes you there', async ({
  page,
}) => {
  // Double-click a part: the full map, at that area.
  await part(page, 'Inventory').dblclick({ position: { x: 150, y: 16 } });
  await expect(toggle(page)).toHaveText('Advanced');
  await page.waitForTimeout(700);
  await expect(page.getByTestId('breadcrumb')).toHaveText(/shop.*Inventory/);
  const stage = (await canvas(page).boundingBox())!;
  const area = (await page.locator('[data-testid="area"][data-name="Inventory"]').boundingBox())!;
  expect(area.x).toBeGreaterThanOrEqual(stage.x);
  expect(area.y).toBeGreaterThanOrEqual(stage.y);
  expect(area.x + area.width).toBeLessThanOrEqual(stage.x + stage.width);
  expect(area.width).toBeGreaterThan(stage.width * 0.3);
  await expect(block(page, 'Reservations')).toBeVisible();
  // The panel did not slide in under the second click.
  await expect(page.getByTestId('panel')).toHaveCount(0);

  // The Open button on a card, and Enter on a selected part, do the same.
  await toggle(page).click();
  await part(page, 'Payments').hover();
  await part(page, 'Payments').getByTestId('part-open').click();
  await expect(toggle(page)).toHaveText('Advanced');
  await expect(page.getByTestId('breadcrumb')).toHaveText(/shop.*Payments/);
  await page.keyboard.press('s');
  await part(page, 'Catalog').locator('.dd-part-name').click();
  await expect(part(page, 'Catalog')).toHaveClass(/is-selected/);
  await page.keyboard.press('Enter');
  await expect(toggle(page)).toHaveText('Advanced');
  await expect(page.getByTestId('breadcrumb')).toHaveText(/shop.*Catalog/);

  // Search finds a block. Blocks live in the advanced view, so that is where it lands.
  await page.keyboard.press('s');
  await expect(toggle(page)).toHaveText('Simple');
  await page.keyboard.press('Control+k');
  await page.getByTestId('palette').locator('input').fill('Refunds');
  await expect(page.getByTestId('palette-item').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(toggle(page)).toHaveText('Advanced');
  await expect(block(page, 'Refunds')).toHaveClass(/is-selected/);
  await expect(page.getByTestId('breadcrumb')).toHaveText(/shop.*Payments.*Refunds/);

  // So does a block picked from a part's panel.
  await page.keyboard.press('Escape');
  await page.keyboard.press('s');
  await part(page, 'Orders').locator('.dd-part-name').click();
  await page.getByTestId('panel-block').filter({ hasText: 'Checkout' }).click();
  await expect(toggle(page)).toHaveText('Advanced');
  await expect(block(page, 'Checkout')).toHaveClass(/is-selected/);
});

test('asking in plain words: a request on a part, a connection drawn between two, and nothing else moves', async ({
  page,
}) => {
  const before = await boxes(page);

  // On the card: one click, one sentence, Enter.
  await part(page, 'Catalog').getByTestId('part-ask').click();
  await page.getByTestId('part-ask-input').fill('Let customers save products to a wish list');
  await page.keyboard.press('Enter');
  const asked = part(page, 'Catalog').locator('[data-testid="part-row"][data-state="requested"]');
  await expect(asked).toHaveText('Let customers save products to a wish list');
  await expect(part(page, 'Catalog').getByTestId('part-work')).toHaveText('1 request not sent');
  await expect(page.getByTestId('changes-count')).toHaveText('1');
  // The panel did not open, and the picture is still whole.
  await expect(page.getByTestId('panel')).toHaveCount(0);
  await expect(part(page, 'HTTP')).toBeVisible();
  // The card grew by a line, and the others made room for it. Nothing changed places.
  const after = await boxes(page);
  expect(after.Catalog![3]).toBeGreaterThan(before.Catalog![3]!);
  for (const name of ['HTTP', 'Orders', 'Payments', 'Inventory']) {
    expect(Math.abs(after[name]![0]! - before[name]![0]!)).toBeLessThan(40);
    expect(Math.abs(after[name]![1]! - before[name]![1]!)).toBeLessThan(40);
    expect(after[name]!.slice(2)).toEqual(before[name]!.slice(2));
  }

  // The same request, as the change tray and an agent will see it.
  await page.getByTestId('changes').click();
  const change = page.getByTestId('change').first();
  await expect(change.getByTestId('change-state')).toHaveText('Draft');
  await expect(change).toContainText('Add “Let customers save products to a wish list” to Catalog');
  await change.getByTestId('as-text').click();
  await expect(change.getByTestId('deck-text')).toContainText('## area: Catalog');
  await expect(change.getByTestId('deck-text')).toContainText('▪ Let customers save products to a wish list');
  await expect(change.getByTestId('deck-text')).toContainText('[requested of this area]');
  await page.getByTestId('changes').click();

  // Between two parts: drag from one to the other and say what should happen.
  const placed = await boxes(page);
  await part(page, 'Payments').hover();
  const port = (await part(page, 'Payments').locator('.dd-port').nth(1).boundingBox())!;
  const target = (await part(page, 'Inventory').boundingBox())!;
  await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId('connection-form')).toContainText(
    'What should Payments ask Inventory to do?',
  );
  await page.getByTestId('connection-text').fill('put stock back when a payment is refunded');
  await page.getByTestId('connection-submit').click();

  const payments = await partId(page, 'Payments');
  const inventory = await partId(page, 'Inventory');
  const line = connection(page, payments, inventory);
  await expect(line).toHaveAttribute('data-s', 'requested');
  expect(
    await line
      .locator('.dd-edge-line')
      .first()
      .evaluate((el) => getComputedStyle(el).strokeDasharray),
  ).not.toBe('none');
  await expect(label(page, 'put stock back when a payment is refunded')).toHaveAttribute(
    'data-s',
    'requested',
  );
  await expect(page.getByTestId('changes-count')).toHaveText('2');
  // Asking for a connection moves no card at all.
  expect(await boxes(page)).toEqual(placed);
  // The new line goes around the card that lies between its two ends.
  const lineBox = (await label(page, 'put stock back when a payment is refunded').boundingBox())!;
  expect(overlaps(lineBox, (await part(page, 'Catalog').boundingBox())!)).toBe(false);
  await expect(part(page, 'Payments').getByTestId('part-work')).toHaveText('1 request not sent');
  await expect(part(page, 'Inventory').getByTestId('part-work')).toHaveText('1 request not sent');

  // The full map shows the same request between the two areas, dashed.
  await toggle(page).click();
  await expect(page.getByTestId('block').first()).toBeVisible();
  await page.waitForTimeout(500);
  await setZoom(page, 0.2);
  const areaArrow = page.locator(`[data-testid="arrow"][data-from="${payments}"][data-to="${inventory}"]`);
  await expect(areaArrow).toHaveAttribute('data-s', 'requested');
  await toggle(page).click();
  await expect(page.getByTestId('part')).toHaveCount(6);

  // A request can be taken back from the part's panel, or undone.
  await part(page, 'Catalog').locator('.dd-part-name').click();
  await expect(page.getByTestId('panel-name')).toHaveText('Catalog');
  await expect(page.getByTestId('panel-line').filter({ hasText: 'wish list' })).toHaveAttribute(
    'data-state',
    'requested',
  );
  await page.getByTestId('panel-unask').click();
  await expect(asked).toHaveCount(0);
  await expect(page.getByTestId('changes-count')).toHaveText('1');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect(asked).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(line).toHaveCount(0);
  await expect(page.getByTestId('changes-count')).toHaveText('1');

  // Requests are part of the map: they are still there after a reload.
  await page.reload();
  await ready(page);
  await expect(asked).toHaveCount(1);
});

test('the panel says the same things in plain words, and anyone can say them better', async ({ page }) => {
  await part(page, 'Orders').locator('.dd-part-name').click();
  const panel = page.getByTestId('panel');
  await expect(page.getByTestId('panel-name')).toHaveText('Orders');
  await expect(panel).toContainText('What it is for');
  await expect(page.getByTestId('panel-summary')).toContainText(
    'Takes a customer from a full cart to a paid order',
  );
  // Where the words came from is said once, here, and not on the card.
  await expect(page.getByTestId('panel-summary')).toContainText('AI summary');
  await expect(page.getByTestId('panel-line')).toHaveCount(4);
  // What it talks to, each way, in the words on the lines.
  const talks = page.getByTestId('panel-connection');
  await expect(talks.filter({ hasText: 'Payments' })).toContainText('charges and refunds customers');
  await expect(talks.filter({ hasText: 'HTTP' })).toContainText('places and tracks orders');
  await expect(talks.filter({ hasText: 'Shared' })).toContainText('uses shared');
  await expect(page.getByTestId('panel-block')).toHaveCount(8);
  // The picture kept its size: the selected part is still in view beside the panel.
  await expect(part(page, 'Orders')).toBeInViewport({ ratio: 0.99 });

  // Rewrite what the part is for. The card follows, and says a person wrote it.
  await page.getByTestId('panel-summary-edit').click();
  await page.getByTestId('panel-summary-input').fill('Everything between "add to cart" and "thank you"');
  await page.keyboard.press('Enter');
  await expect(part(page, 'Orders').getByTestId('part-summary')).toHaveText(
    'Everything between "add to cart" and "thank you"',
  );
  await expect(page.getByTestId('panel-summary')).toContainText('written by hand');

  // A connection has a panel too. Its label can be rewritten, and emptied to get the old one back.
  await talks.filter({ hasText: 'Payments' }).click();
  await expect(page.getByTestId('panel-name')).toHaveText('Orders → Payments');
  await expect(panel).toContainText('What Orders asks of Payments');
  await page.getByTestId('panel-label-edit').click();
  await page.getByTestId('panel-label-input').fill('takes the money');
  await page.keyboard.press('Enter');
  await expect(label(page, 'takes the money')).toBeVisible();
  await expect(label(page, 'charges and refunds customers')).toHaveCount(0);

  // Both survive a reload: they are notes, kept with the map.
  await page.reload();
  await ready(page);
  await expect(part(page, 'Orders').getByTestId('part-summary')).toHaveText(
    'Everything between "add to cart" and "thank you"',
  );
  await label(page, 'takes the money').click();
  await page.getByTestId('panel-label-edit').click();
  await page.getByTestId('panel-label-input').fill('');
  await page.keyboard.press('Enter');
  await expect(label(page, 'charges and refunds customers')).toBeVisible();
});

test('hover lights a part and what it talks to; arrows move between parts; Esc unwinds', async ({ page }) => {
  await part(page, 'Payments').hover({ position: { x: 150, y: 16 } });
  await expect(part(page, 'Catalog')).toHaveClass(/dd-dim/);
  await expect(part(page, 'Orders')).not.toHaveClass(/dd-dim/);
  // Common ground belongs to everything, so it never dims.
  await expect(part(page, 'Shared')).not.toHaveClass(/dd-dim/);
  await page.mouse.move(700, 60);
  await expect(part(page, 'Catalog')).not.toHaveClass(/dd-dim/);

  await part(page, 'HTTP').locator('.dd-part-name').click();
  await expect(part(page, 'HTTP')).toHaveClass(/is-selected/);
  await page.keyboard.press('ArrowRight');
  await expect(part(page, 'Orders')).toHaveClass(/is-selected/);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-testid="part"].is-selected')).toHaveCount(1);
  await expect(part(page, 'Orders')).not.toHaveClass(/is-selected/);
  // N asks on the selected part.
  await page.keyboard.press('n');
  await expect(page.getByTestId('part-ask-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('part-ask-input')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="part"].is-selected')).toHaveCount(0);
  await expect(page.getByTestId('panel')).toHaveCount(0);
});

test('the simple view moves as freely as the full map', async ({ page }, info) => {
  const stage = (await canvas(page).boundingBox())!;
  const cx = stage.x + stage.width / 2;
  const cy = stage.y + stage.height / 2;
  const pan = await measureFps(page, async () => {
    await page.mouse.move(cx, cy + 200);
    await page.mouse.down();
    for (let i = 1; i <= 40; i++) await page.mouse.move(cx + Math.sin(i / 6) * 260, cy + 200 - i * 4);
    await page.mouse.up();
  });
  const wheel = await measureFps(page, async () => {
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 30; i++) {
      await page.mouse.wheel(0, i < 15 ? 60 : -60);
      await page.waitForTimeout(16);
    }
  });
  info.annotations.push({ type: 'fps', description: `pan p95 ${pan.p95}, wheel p95 ${wheel.p95}` });
  console.log(`simple view: pan p95 ${pan.p95} fps, wheel zoom p95 ${wheel.p95} fps`);
  expect(pan.p95).toBeGreaterThanOrEqual(60);
  expect(wheel.p95).toBeGreaterThanOrEqual(45);
});

test('a larger map: the simple view of 300 blocks is still a handful of parts', async ({ page }) => {
  await openFixture(page, 'mid', 'simple');
  const parts = await page.getByTestId('part').count();
  expect(parts).toBeGreaterThan(3);
  expect(parts).toBeLessThanOrEqual(12);
  expect(await smallText(page)).toEqual([]);
  // Every part is on screen after the first fit.
  for (const el of await page.getByTestId('part').all()) await expect(el).toBeInViewport({ ratio: 0.99 });
});
