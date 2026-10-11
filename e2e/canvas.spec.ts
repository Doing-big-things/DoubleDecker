// M0 and M2 on the hand-written shop fixture, with no server (spec §11).
import { expect, test } from '@playwright/test';
import {
  arrow,
  block,
  canvas,
  flyTo,
  measureFps,
  openFixture,
  ready,
  setZoom,
  smallText,
  wheelTo,
  zoom,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await openFixture(page);
});

test('opens on the whole map and shows one level of abstraction per zoom level', async ({ page }) => {
  // Fit-all on a laptop screen lands at Architecture: every block by name, nothing else.
  await expect(canvas(page)).toHaveAttribute('data-level', 'architecture');
  await expect(page.getByTestId('block')).toHaveCount(42);
  await expect(block(page, 'Inventory')).toHaveText(/Inventory/);
  await expect(page.locator('.dd-bullet')).toHaveCount(0);
  await expect(page.getByTestId('area-title')).toHaveCount(8);

  // Wheel in at the Inventory block: full cards with summary, bullets and a tests chip.
  const inv = (await block(page, 'Inventory').boundingBox())!;
  await wheelTo(page, 'blocks', { x: inv.x + inv.width / 2, y: inv.y + inv.height / 2 });
  await expect(block(page, 'Inventory')).toContainText('Tracks stock and reservations');
  await expect(block(page, 'Inventory')).toContainText('Reserve stock for an order');
  await expect(block(page, 'Inventory').getByTestId('tests-chip')).toHaveText('✓12');

  // Wheel out: blocks become unlabeled chips and areas carry their counts.
  await wheelTo(page, 'system');
  await expect(page.getByTestId('block')).toHaveCount(0);
  await expect(page.locator('.dd-chips path').first()).toBeVisible();
  const orders = page.locator('[data-testid="area"][data-name="Orders"]');
  await expect(orders).toContainText('Orders');
  await expect(orders).toContainText('8 blocks');
  await expect(orders).toContainText('✕2');
  // One arrow per pair of areas, with a count.
  await expect(page.getByTestId('arrow').first()).toBeVisible();
  expect(await page.getByTestId('arrow').count()).toBeLessThan(20);
});

test('zooming changes the drawing and never the layout', async ({ page }) => {
  const rect = (name: string) =>
    page.evaluate((n) => {
      const st = window.__decker.store.getState();
      const id = st.index.blocks.find((b: { name: string }) => b.name === n).id;
      const box = window.__decker.camera.box(id);
      return [box.ax, box.ay, box.w, box.h];
    }, name);
  const before = await rect('Checkout');
  await setZoom(page, 1.2);
  expect(await rect('Checkout')).toEqual(before);
  await setZoom(page, 0.12);
  expect(await rect('Checkout')).toEqual(before);
});

test('no text is ever drawn smaller than 11 px on screen', async ({ page }) => {
  const problems: string[] = [];
  for (const z of [0.06, 0.12, 0.22, 0.31, 0.37, 0.45, 0.52, 0.61, 0.7, 0.8, 0.9, 1, 1.6]) {
    await setZoom(page, z);
    problems.push(...(await smallText(page)));
  }
  // Open everything dense, then check the detailed view again.
  await flyTo(page, 'Inventory');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+T');
  for (const z of [0.62, 0.8, 1]) {
    await setZoom(page, z);
    problems.push(...(await smallText(page)));
  }
  expect(problems).toEqual([]);
});

test('hover keeps a block and its neighbors and dims the rest', async ({ page }) => {
  await flyTo(page, 'Reservations');
  await page.keyboard.press('Escape');
  await block(page, 'Reservations').hover();
  await expect(block(page, 'Restock')).toHaveClass(/dd-dim/);
  await expect(block(page, 'Reservations')).not.toHaveClass(/dd-dim/);
  await expect(block(page, 'StockStore')).not.toHaveClass(/dd-dim/);
  await expect(block(page, 'Inventory')).not.toHaveClass(/dd-dim/);
  await expect
    .poll(async () => Number(await block(page, 'Restock').evaluate((el) => getComputedStyle(el).opacity)))
    .toBeCloseTo(0.35, 1);
  await page.mouse.move(5, 300);
  await expect(block(page, 'Restock')).not.toHaveClass(/dd-dim/);
});

test('drilling in: select, expand in place, internals, tests, and the code peek', async ({ page }) => {
  await flyTo(page, 'Inventory');
  const card = block(page, 'Inventory');
  await expect(card).toHaveClass(/is-selected/);

  // The panel: summary, every bullet with where it came from, operations, arrows, evidence.
  const panel = page.getByTestId('panel');
  await expect(panel.getByTestId('panel-name')).toHaveText(/Inventory/);
  await expect(panel).toContainText('Tracks stock and reservations');
  await expect(
    panel.getByTestId('panel-bullet').filter({ hasText: 'Reserve stock for an order' }),
  ).toContainText('doc comment');
  await expect(
    panel.getByTestId('panel-bullet').filter({ hasText: 'Rejects the whole order' }),
  ).toContainText('AI summary');
  await expect(panel.getByTestId('panel-op').first()).toContainText('reserve(orderId: OrderId');
  await expect(panel.getByTestId('panel-arrow').filter({ hasText: 'Checkout' })).toContainText(
    'API · reserve',
  );

  // Five bullets on the card, the rest behind "+N more".
  await expect(card.locator('.dd-bullet')).toHaveCount(5);
  await expect(card.locator('.dd-more')).toHaveText('+2 more');

  // Expand in place: the card grows, the block below moves down, and returns on collapse.
  const below = block(page, 'Reservations');
  const y0 = (await below.boundingBox())!.y;
  const h0 = (await card.boundingBox())!.height;
  await card.getByTestId('expand').click();
  await expect(card).toContainText('Operations');
  await expect(card).toContainText('reserve(orderId, items, key)');
  await expect(card).toContainText('interface Reservation');
  await expect.poll(async () => (await card.boundingBox())!.height).toBeGreaterThan(h0 + 150);
  await expect.poll(async () => (await below.boundingBox())!.y).toBeGreaterThan(y0 + 150);
  await card.getByTestId('internals').click();
  await expect(card.locator('.dd-arcs path').first()).toBeVisible();
  await expect(card).toContainText('lockFor(sku) · internal');
  await page.keyboard.press('Enter');
  await expect(card).not.toContainText('Operations');
  await expect.poll(async () => Math.round((await below.boundingBox())!.y)).toBe(Math.round(y0));

  // Code peek: read-only source headed by path:line, with the block's code in it.
  await panel.getByTestId('tab-source').click();
  const peek = page.getByTestId('code-peek');
  await expect(peek).toContainText('src/inventory/index.ts:1');
  await expect(peek).toContainText('export function reserve');
  // An arrow in the panel flies to its other end.
  await panel.getByTestId('tab-overview').click();
  await panel.getByTestId('panel-arrow').filter({ hasText: 'Checkout' }).click();
  await expect(panel.getByTestId('panel-name')).toHaveText(/Checkout/);
  await expect(block(page, 'Checkout')).toHaveClass(/is-selected/);
});

test('tests hang off the architecture behind a collapsed chip', async ({ page }) => {
  // Every chip state is on the map.
  await flyTo(page, 'Checkout');
  await expect(block(page, 'Checkout').getByTestId('tests-chip')).toHaveText('✕2/9');
  await expect(block(page, 'Orders').getByTestId('tests-chip')).toHaveText('✓12');
  await flyTo(page, 'Discounts');
  await expect(block(page, 'Discounts').getByTestId('tests-chip')).toHaveText('6');
  await flyTo(page, 'InventoryRoutes');
  await expect(block(page, 'InventoryRoutes').getByTestId('tests-chip')).toHaveText('0');
  await flyTo(page, 'Fulfillment');
  await expect(block(page, 'Fulfillment').getByTestId('tests-chip')).toHaveText('✓3/4');

  // The chip costs no space; the drawer opens in place, grouped by operation, failing first.
  await flyTo(page, 'Checkout');
  const card = block(page, 'Checkout');
  const closed = (await card.boundingBox())!.height;
  await card.getByTestId('tests-chip').click();
  const drawer = card.getByTestId('tests-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.dd-drawer-group').first()).toContainText('run');
  await expect(drawer.locator('.dd-test').first()).toContainText('releases stock when the charge fails');
  await expect(drawer.locator('.dd-test').first().locator('.dd-glyph')).toHaveText('✕');
  await expect(drawer.locator('.dd-test')).toHaveCount(8);
  await expect(drawer).toContainText('+1 more');
  await expect.poll(async () => (await card.boundingBox())!.height).toBeGreaterThan(closed + 150);

  // A test opens its source in the code peek; the panel's Tests tab has the full list.
  await drawer.locator('.dd-test').first().click();
  await expect(page.getByTestId('code-peek')).toContainText("it('releases stock when the charge fails'");
  await page.getByTestId('tab-tests').click();
  await expect(page.getByTestId('panel-test')).toHaveCount(9);
  await expect(page.getByTestId('panel')).toContainText('This is not coverage');

  // T closes it again, and a skipped test is never counted as passed.
  await page.keyboard.press('t');
  await expect(drawer).toHaveCount(0);
  await flyTo(page, 'Fulfillment');
  await page.keyboard.press('t');
  await expect(
    block(page, 'Fulfillment')
      .locator('.dd-test')
      .filter({ hasText: 'prints a packing slip' })
      .locator('.dd-glyph'),
  ).toHaveText('–');
  await page.keyboard.press('t');

  // Shift+T opens every drawer in view, and at Architecture level marks every block.
  await page.keyboard.press('Shift+T');
  await expect(page.getByTestId('tests-drawer').first()).toBeVisible();
  expect(await page.getByTestId('tests-drawer').count()).toBeGreaterThan(2);
  await setZoom(page, 0.4);
  await expect(canvas(page)).toHaveAttribute('data-level', 'architecture');
  await expect(page.locator('.dd-arch-chip').first()).toBeVisible();
  await expect(page.locator('.dd-arch-chip', { hasText: /^0$/ }).first()).toBeVisible();
  await page.keyboard.press('Shift+T');
  // Without it, only failing blocks are marked.
  await page.keyboard.press('0');
  await expect(page.getByTestId('block')).toHaveCount(42);
  await expect(canvas(page)).toHaveAttribute('data-level', 'architecture');
  await expect(page.locator('.dd-arch-chip')).toHaveCount(0);
  await expect(page.getByTestId('arch-fail')).toHaveCount(2);
});

test('search and fly, breadcrumb, shareable URL, and camera history', async ({ page }) => {
  const start = await zoom(page);
  // Search covers names, behavior and tests.
  await page.keyboard.press('Control+k');
  await page.getByTestId('palette').locator('input').fill('zzz-nothing');
  await expect(page.getByTestId('palette')).toContainText('Nothing on the deck matches');
  await page.getByTestId('palette').locator('input').fill('refund all or part');
  await expect(page.getByTestId('palette-item').first()).toContainText('refund');
  await page.keyboard.press('Enter');
  await expect(block(page, 'Refunds')).toHaveClass(/is-selected/);
  await expect(page.getByTestId('breadcrumb')).toHaveText(/shop.*Payments.*Refunds/);
  expect(page.url()).toMatch(/#\/block\/blk_/);
  await expect.poll(() => zoom(page)).toBeGreaterThan(0.85);

  // The link reopens the same view.
  const url = page.url();
  await page.goto('about:blank');
  await page.goto(url);
  await ready(page);
  await expect(block(page, 'Refunds')).toHaveClass(/is-selected/, { timeout: 10_000 });

  // Alt+Left returns the camera; browser back clears the focus.
  await flyTo(page, 'Money');
  await expect(block(page, 'Money')).toHaveClass(/is-selected/);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(block(page, 'Refunds')).toHaveClass(/is-selected/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('0');
  await expect.poll(() => zoom(page)).toBeCloseTo(start, 1);
});

test('keyboard: arrows move the selection, Esc unwinds one step at a time', async ({ page }) => {
  await flyTo(page, 'Orders');
  const first = await page.getByTestId('panel-name').innerText();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('panel-name')).not.toHaveText(first);
  const moved = await page.locator('.dd-block.is-selected').getAttribute('data-name');
  expect(moved).not.toBe('Orders');
  await page.keyboard.press('ArrowUp');

  // Esc: collapse the expansion, clear the selection, zoom out to the area, then fit.
  await page.keyboard.press('Enter');
  const selected = page.locator('.dd-block.is-selected');
  await expect(selected).toContainText('Operations');
  await page.keyboard.press('Escape');
  await expect(selected).not.toContainText('Operations');
  await expect(selected).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.dd-block.is-selected')).toHaveCount(0);
  await expect(page.getByTestId('panel')).toHaveCount(0);
  const z1 = await zoom(page);
  await page.keyboard.press('Escape');
  await expect.poll(() => zoom(page)).toBeLessThan(z1);
  await page.keyboard.press('?');
  await expect(page.getByTestId('help')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('help')).toHaveCount(0);
});

test('the outline is the same deck as a searchable tree', async ({ page, context }) => {
  await page.keyboard.press('Control+\\');
  const outline = page.getByTestId('outline');
  await expect(outline).toBeVisible();
  await expect(
    outline
      .getByTestId('outline-row')
      .filter({ hasText: /^Inventory$/ })
      .first(),
  ).toBeVisible();
  await outline.getByTestId('outline-filter').fill('reserve stock');
  await expect(outline.getByTestId('outline-row').filter({ hasText: /^Catalog$/ })).toHaveCount(0);
  await outline
    .locator('.dd-tree-row[data-kind="bullet"]')
    .filter({ hasText: 'Reserve stock for an order' })
    .click();
  await expect(block(page, 'Inventory')).toHaveClass(/is-selected/);
  // Deck text: the same deck as a plain outline, and the format agents receive.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await outline.getByTestId('copy-deck-text').click();
  await expect(page.getByTestId('toast')).toHaveText('Deck text copied');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('# shop');
  expect(text).toContain('## area: Inventory');
  expect(text).toMatch(/### block: Inventory\s+src\/inventory\/index\.ts/);
  expect(text).toMatch(/• Reserve stock for an order\s+reserve\(orderId, items, key\)/);
  expect(text).toContain('◦ Rejects the whole order if any item is short');
  expect(text).toContain('<- Checkout: API · reserve');
  await page.keyboard.press('Control+\\');
  await expect(outline).toHaveCount(0);
});

test('positions survive a reload; dragging and Tidy up work and undo', async ({ page }) => {
  await flyTo(page, 'Money');
  await page.keyboard.press('Escape');
  const card = block(page, 'Money');
  const a = (await card.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + 14);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 60, a.y + 60, { steps: 6 });
  await page.mouse.move(a.x + a.width / 2 + 120, a.y + 110, { steps: 6 });
  await page.mouse.up();
  const moved = (await card.boundingBox())!;
  expect(moved.x).toBeGreaterThan(a.x + 80);

  const place = () =>
    page.evaluate(() => {
      const st = window.__decker.store.getState();
      const id = st.index.blocks.find((b: { name: string }) => b.name === 'Money').id;
      return st.positions[id];
    });
  const dragged = await place();
  await page.waitForTimeout(500);
  await page.reload();
  await ready(page);
  expect(await place()).toEqual(dragged);

  // Tidy up lays everything out again, and Ctrl+Z puts the hand-placed block back.
  await page.getByTestId('tidy').click();
  await expect.poll(async () => JSON.stringify(await place())).not.toBe(JSON.stringify(dragged));
  await page.keyboard.press('Control+z');
  await expect.poll(async () => JSON.stringify(await place())).toBe(JSON.stringify(dragged));
});

test('dragging a block into another area regroups the picture, and nothing else', async ({ page }) => {
  const area = (name: string) => page.locator(`[data-testid="area"][data-name="${name}"]`);
  const parentOf = (name: string) =>
    page.evaluate((n) => {
      const st = window.__decker.store.getState();
      const b = st.index.blocks.find((x: { name: string }) => x.name === n);
      return st.index.byId.get(b.parentId).name as string;
    }, name);
  await page.keyboard.press('0');
  await page.waitForTimeout(500);
  expect(await parentOf('StockAlerts')).toBe('Inventory');

  // While the card is held over Catalog, that area lights up as the place it would land.
  const card = block(page, 'StockAlerts');
  const from = (await card.boundingBox())!;
  const to = (await area('Catalog').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 30, from.y + 30, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await expect(area('Catalog')).toHaveClass(/is-drop/);
  await expect(area('Inventory')).not.toHaveClass(/is-drop/);
  await page.mouse.up();
  await expect(area('Catalog')).not.toHaveClass(/is-drop/);

  // It is drawn in Catalog now, clear of its new neighbours, and no area covers another.
  expect(await parentOf('StockAlerts')).toBe('Catalog');
  await expect(page.getByTestId('toast')).toContainText('Its code has not moved');
  await page.waitForTimeout(400);
  const overlaps = await page.evaluate(() => {
    const rect = (el: Element) => el.getBoundingClientRect();
    const hit = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const st = window.__decker.store.getState();
    const out: string[] = [];
    const tops = [...document.querySelectorAll('[data-testid="area"][data-depth="0"]')];
    for (const a of tops)
      for (const b of tops)
        if (a !== b && hit(rect(a), rect(b)))
          out.push(`${a.getAttribute('data-name')} covers ${b.getAttribute('data-name')}`);
    const catalog = st.index.areas.find((x: { name: string }) => x.name === 'Catalog').id;
    const cards = [...document.querySelectorAll('[data-testid="block"]')].filter(
      (el) => st.index.byId.get(el.getAttribute('data-id'))?.parentId === catalog,
    );
    for (const a of cards)
      for (const b of cards)
        if (a !== b && hit(rect(a), rect(b)))
          out.push(`${a.getAttribute('data-name')} covers ${b.getAttribute('data-name')}`);
    return out;
  });
  expect(overlaps).toEqual([]);

  // Regrouping is a change to the picture only: no operation, no request, nothing for an agent.
  await expect(page.getByTestId('changes')).not.toContainText(/\d/);
  await card.click();
  await expect(page.getByTestId('regrouped')).toContainText('Catalog, by hand. Its code is in Inventory.');

  // It survives a reload, undoes and redoes, and can be put back from the panel.
  await page.waitForTimeout(500);
  await page.reload();
  await ready(page);
  expect(await parentOf('StockAlerts')).toBe('Catalog');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Shift+z');
  expect(await parentOf('StockAlerts')).toBe('Catalog');
  await page.keyboard.press('0');
  await page.waitForTimeout(400);
  await block(page, 'StockAlerts').click();
  await page.getByTestId('put-back').click();
  expect(await parentOf('StockAlerts')).toBe('Inventory');
  await expect(page.getByTestId('regrouped')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  expect(await parentOf('StockAlerts')).toBe('Catalog');
});

test('the light theme comes from the same tokens and is remembered', async ({ page }) => {
  const bg = () =>
    page.evaluate(() => getComputedStyle(document.querySelector('.react-flow')!).backgroundColor);
  expect(await bg()).toBe('rgb(14, 15, 18)');
  await page.getByTestId('theme').click();
  expect(await bg()).toBe('rgb(244, 245, 247)');
  await page.reload();
  await ready(page);
  expect(await bg()).toBe('rgb(244, 245, 247)');
  // Body text keeps at least 4.5:1 contrast against its surface in both themes.
  const contrast = () =>
    page.evaluate(() => {
      const lum = (c: string) => {
        const [r, g, b] = c.match(/\d+/g)!.map((v) => {
          const x = Number(v) / 255;
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      };
      const cs = getComputedStyle(document.documentElement);
      const probe = (fg: string, bg: string) => {
        const el = document.createElement('i');
        el.style.color = cs.getPropertyValue(fg);
        el.style.backgroundColor = cs.getPropertyValue(bg);
        document.body.append(el);
        const s = getComputedStyle(el);
        const [a, b] = [lum(s.color), lum(s.backgroundColor)];
        el.remove();
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      return [probe('--text', '--surface'), probe('--muted', '--surface'), probe('--muted', '--chrome')];
    });
  for (const ratio of await contrast()) expect(ratio).toBeGreaterThan(4.5);
  await page.getByTestId('theme').click();
  for (const ratio of await contrast()) expect(ratio).toBeGreaterThan(4.5);
});

test('editing the deck: every gesture becomes an operation, and a request never looks implemented', async ({
  page,
}) => {
  // 1. Click a bullet and type: set_behavior.
  await flyTo(page, 'Pricing');
  const pricing = block(page, 'Pricing');
  await pricing.locator('.dd-bullet-text', { hasText: 'Price one line' }).click();
  await pricing.locator('input.dd-inline-edit').fill('Price one line, with bulk discounts');
  await page.keyboard.press('Enter');
  await expect(pricing.locator('.dd-bullet.is-changed')).toContainText('with bulk discounts');
  await expect(page.getByTestId('changes-count')).toHaveText('1');

  // 2. Add a bullet from the panel: add_behavior.
  await page.getByTestId('add-bullet').first().click();
  await page.getByTestId('add-bullet-input').fill('Round every total to the cent');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(pricing.locator('.dd-bullet.is-requested, .dd-more')).not.toHaveCount(0);

  // 3. N: a new block, dashed and badged.
  await page.keyboard.press('n');
  await page.getByTestId('block-name').fill('Notifications');
  await page
    .getByTestId('block-bullets')
    .fill('Email a receipt when an order is placed\nText the customer when an order ships');
  await page.getByTestId('block-submit').click();
  await flyTo(page, 'Notifications');
  const added = block(page, 'Notifications');
  await expect(added).toHaveClass(/is-requested/);
  await expect(added.getByTestId('badge-requested')).toBeVisible();
  expect(await added.evaluate((el) => getComputedStyle(el).borderStyle)).toBe('dashed');
  // An implemented block is solid and carries no badge.
  expect(await block(page, 'Pricing').evaluate((el) => getComputedStyle(el).borderStyle)).toBe('solid');
  await expect(block(page, 'Pricing').getByTestId('badge-requested')).toHaveCount(0);

  // 4. Drag from a block's edge to another block: add_edge, with kind, label and bullets.
  await flyTo(page, 'Discounts');
  await page.keyboard.press('Escape');
  const from = block(page, 'Discounts');
  const to = block(page, 'Pricing');
  await from.hover();
  const port = (await from.locator('.dd-port').nth(0).boundingBox())!;
  const target = (await to.boundingBox())!;
  await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId('edge-form')).toBeVisible();
  await page.getByTestId('kind-api').click();
  await page.getByTestId('edge-label').fill('Quote a discount');
  await page.getByTestId('edge-bullets').fill('Never quote below zero');
  await page.getByTestId('edge-submit').click();
  const ids = await page.evaluate(() => {
    const st = window.__decker.store.getState();
    const id = (n: string) => st.index.blocks.find((b: { name: string }) => b.name === n).id;
    return { discounts: id('Discounts'), pricing: id('Pricing'), money: id('Money') };
  });
  const requested = arrow(page, ids.discounts, ids.pricing);
  await expect(requested).toHaveAttribute('data-s', 'requested');
  expect(
    await requested.locator('.dd-edge-line').evaluate((el) => getComputedStyle(el).strokeDasharray),
  ).not.toBe('none');
  await expect(page.getByTestId('arrow-pill').filter({ hasText: 'Quote a discount' })).toContainText(
    'Requested',
  );
  // An implemented arrow is a solid line.
  const solid = arrow(page, ids.discounts, ids.money);
  expect(await solid.locator('.dd-edge-line').evaluate((el) => getComputedStyle(el).strokeDasharray)).toBe(
    'none',
  );

  // 5. F2 renames; 6. Delete requests removal.
  await flyTo(page, 'Categories');
  await page.keyboard.press('F2');
  await block(page, 'Categories').locator('input.dd-block-name').fill('CategoryTree');
  await page.keyboard.press('Enter');
  await expect(block(page, 'CategoryTree').locator('.dd-block-name s')).toHaveText('Categories');
  await flyTo(page, 'Images');
  await page.keyboard.press('Delete');
  await expect(block(page, 'Images')).toHaveClass(/is-removed/);

  // The tray lists all six operations, reads as a task, and nothing was sent anywhere.
  await page.getByTestId('changes').click();
  const tray = page.getByTestId('tray');
  await expect(tray.getByTestId('op')).toHaveCount(6);
  for (const type of ['set_behavior', 'add_behavior', 'add_block', 'add_edge', 'rename', 'remove']) {
    await expect(tray.locator(`[data-testid="op"][data-type="${type}"]`)).toHaveCount(1);
  }
  await expect(tray.getByTestId('change-state')).toHaveText('Draft');
  await expect(tray.getByTestId('submit')).toBeDisabled();
  await tray.getByTestId('as-text').click();
  const text = await tray.getByTestId('deck-text').innerText();
  expect(text).toContain('block: Notifications');
  expect(text).toContain('[requested: new block]');
  expect(text).toContain('-> Pricing: API Quote a discount');
  expect(text).toContain('Price one line, with bulk discounts');
  expect(text).toContain('[rename requested: CategoryTree]');
  expect(text).toContain('[remove requested]');

  // Moving a block is layout only: it never adds an operation.
  await page.keyboard.press('Escape');
  await flyTo(page, 'Clock');
  await page.keyboard.press('Escape');
  const clock = (await block(page, 'Clock').boundingBox())!;
  await page.mouse.move(clock.x + 60, clock.y + 14);
  await page.mouse.down();
  await page.mouse.move(clock.x + 100, clock.y + 60, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('changes-count')).toHaveText('6');

  // Everything survives a reload.
  await page.waitForTimeout(400);
  await page.reload();
  await ready(page);
  await expect(page.getByTestId('changes-count')).toHaveText('6');
  await flyTo(page, 'Notifications');
  await expect(block(page, 'Notifications')).toHaveClass(/is-requested/);

  // Undo and redo cover pending operations.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('changes-count')).toHaveText('6');
  await flyTo(page, 'Ledger');
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('changes-count')).toHaveText('7');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('changes-count')).toHaveText('6');
  await expect(block(page, 'Ledger')).not.toHaveClass(/is-removed/);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByTestId('changes-count')).toHaveText('7');
  await expect(block(page, 'Ledger')).toHaveClass(/is-removed/);
});

test('stays within budget: the shop fixture, then 1,500 blocks and 3,800 arrows', async ({ page }, info) => {
  const stage = (await canvas(page).boundingBox())!;
  const cx = stage.x + stage.width / 2;
  const cy = stage.y + stage.height / 2;
  const sweep = async () => {
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 14; i++) await page.mouse.wheel(0, i < 7 ? -120 : 120);
    await page.mouse.down();
    for (let i = 0; i < 30; i++)
      await page.mouse.move(cx + Math.sin(i / 5) * 320, cy + Math.cos(i / 5) * 200);
    await page.mouse.up();
  };

  const shop = await measureFps(page, sweep);
  const t0 = Date.now();
  await flyTo(page, 'Inventory');
  await block(page, 'Inventory').getByTestId('expand').click();
  await expect(block(page, 'Inventory')).toContainText('Operations');
  const interact = Date.now() - t0;

  await openFixture(page, 'stress');
  await expect(canvas(page)).toHaveAttribute('data-level', 'system');
  const overview = await measureFps(page, sweep);
  // Zoom into one area: full cards, with off-screen blocks never in the DOM.
  await flyTo(page, 'BillingRateMapper');
  await expect(canvas(page)).toHaveAttribute('data-level', 'blocks');
  const detail = await measureFps(page, sweep);
  let most = 0;
  for (const z of [1, 0.62, 0.45, 0.31]) {
    await setZoom(page, z);
    most = Math.max(most, await page.getByTestId('block').count());
  }

  const report = `shop pan/zoom p95 ${shop.p95} fps (median ${shop.median}) · search+fly+expand ${interact} ms · stress overview p95 ${overview.p95} fps · stress detail p95 ${detail.p95} fps · most blocks in the DOM ${most}`;
  info.annotations.push({ type: 'measured', description: report });
  console.log(`  measured: ${report}`);
  expect(most).toBeLessThanOrEqual(400);
  expect(shop.p95).toBeGreaterThanOrEqual(30);
  expect(overview.p95).toBeGreaterThanOrEqual(20);
});
