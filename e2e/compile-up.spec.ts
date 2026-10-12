// M1: `decker examples/shop` shows the real map (spec §11).

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { cleanup, type Deck, idOf, startDecker } from './decker';
import { block, canvas, flyTo, ready } from './helpers';

test.describe.configure({ mode: 'serial' });

let deck: Deck;
const record = () => path.join(deck.root, '.deck', 'cache', 'editor-call.txt');

test.beforeAll(async () => {
  deck = await startDecker('up', {
    setup(root) {
      // Stand in for the editor: a script that records the path and line it was asked to open.
      const recorder = path.join(root, 'record-editor.mjs').replace(/\\/g, '/');
      const settings = JSON.parse(readFileSync(path.join(root, '.deck', 'deck.json'), 'utf8'));
      settings.editor = `node ${recorder} {path} {line}`;
      writeFileSync(path.join(root, '.deck', 'deck.json'), JSON.stringify(settings, null, 2));
      writeFileSync(
        path.join(root, 'record-editor.mjs'),
        "import { mkdirSync, writeFileSync } from 'node:fs';\nmkdirSync('.deck/cache', { recursive: true });\nwriteFileSync('.deck/cache/editor-call.txt', process.argv.slice(2).join('|'));\n",
      );
    },
  });
});
test.afterAll(async () => cleanup(deck));

test('the real map: areas, blocks, coverage, the opaque construct, and one click to the code', async ({
  page,
}) => {
  await deck.open(page);
  await expect(page.getByTestId('breadcrumb')).toHaveText(/^up-/);
  for (const name of ['Catalog', 'HTTP', 'Inventory', 'Orders', 'Payments', 'Shared']) {
    await expect(page.locator(`[data-testid="area"][data-name="${name}"]`)).toHaveCount(1);
  }
  await expect(page.getByTestId('block')).toHaveCount(23);
  // Coverage is in the top bar. One call cannot be followed, so it is not 100%.
  await expect(page.getByTestId('coverage')).toHaveText('99% resolved');

  // The string-keyed handler registry shows as an opaque marker, and leads to the exact line.
  await flyTo(page, 'Router');
  await expect(block(page, 'Router').getByTestId('opaque')).toHaveText('1');
  await page.getByTestId('panel-gap').click();
  await expect(page.getByTestId('code-peek')).toContainText('src/http/router.ts:');
  await expect(page.locator('.dd-code-line.is-hl').first()).toContainText('this.handlers[match.route]');

  // Route registrations are operations tagged api, described by the operation each one calls.
  await flyTo(page, 'Routes');
  await expect(
    page.getByTestId('panel-bullet').filter({ hasText: 'Place an order from a cart' }),
  ).toBeVisible();
  await expect(page.getByTestId('panel-op').filter({ hasText: 'POST /orders' })).toContainText('api');

  // A block and an operation each open their source at the right line.
  await flyTo(page, 'Inventory');
  await page.getByTestId('tab-source').click();
  await expect(page.getByTestId('code-peek')).toContainText('src/inventory/index.ts:1');
  await expect(page.getByTestId('code-peek')).toContainText('export class Inventory');
  await page.getByTestId('tab-overview').click();
  await page.getByTestId('panel-op').filter({ hasText: 'receive(' }).click();
  await page.getByTestId('tab-source').click();
  const line =
    deck
      .read('src/inventory/index.ts')
      .split('\n')
      .findIndex((l) => l.includes('receive(sku')) + 1;
  await expect(page.getByTestId('code-peek')).toContainText(`src/inventory/index.ts:${line}`);
  await expect(page.locator('.dd-code-line.is-hl').first()).toContainText('receive(sku: Sku, units: number)');

  // Open in editor passes the file and line to the configured editor command.
  rmSync(record(), { force: true });
  await page.getByTestId('open-editor').click();
  await expect
    .poll(() => (existsSync(record()) ? readFileSync(record(), 'utf8') : ''))
    .toMatch(new RegExp(`inventory[\\\\/]index\\.ts\\|${line}$`));
});

test('tests hang off the operations they call; status comes only from a harness run on the current code', async ({
  page,
}) => {
  await deck.open(page);
  await flyTo(page, 'Inventory');
  const chip = block(page, 'Inventory').getByTestId('tests-chip');
  // No harness has run yet: every chip is "not run".
  await expect(chip).toHaveText('5');
  await page.getByTestId('tab-tests').click();
  // A test is listed under every operation it calls directly.
  await expect(page.getByTestId('panel-test').filter({ hasText: 'adds a delivery to stock' })).toHaveCount(2);
  await expect(page.getByTestId('panel').getByText('receive', { exact: true })).toBeVisible();

  await page.getByTestId('run-checks').click();
  await expect(chip).toHaveText('✓5', { timeout: 90_000 });
  await flyTo(page, 'Orders');
  await expect(block(page, 'Orders').getByTestId('tests-chip')).toHaveText('✓7');

  // The code changes: the old result no longer describes it, and the block is marked changed since the baseline.
  deck.write(
    'src/inventory/index.ts',
    `${deck.read('src/inventory/index.ts')}\n// stock is counted in whole units\n`,
  );
  await flyTo(page, 'Inventory');
  await expect(chip).toHaveText('5', { timeout: 15_000 });
  await expect(block(page, 'Inventory').locator('.dd-baseline')).toBeVisible();
  await expect(page.locator('.dd-top')).toContainText('uncommitted');
  deck.git('checkout', '--', 'src/inventory/index.ts');
  await expect(chip).toHaveText('✓5', { timeout: 15_000 });
});

test('the same commit extracts to an identical snapshot', async () => {
  const first = JSON.stringify((await deck.api<{ snapshot: unknown }>('/api/deck')).snapshot);
  await deck.stop();
  rmSync(path.join(deck.root, '.deck', 'cache'), { recursive: true, force: true });
  rmSync(path.join(deck.root, '.deck', 'ids.json'), { force: true });
  await deck.restart();
  const second = JSON.stringify((await deck.api<{ snapshot: unknown }>('/api/deck')).snapshot);
  expect(second.length).toBeGreaterThan(20_000);
  expect(second).toBe(first);
});

test('a one-file edit updates the map within budget and moves nothing else', async ({ page }) => {
  await deck.open(page);
  await flyTo(page, 'Products');
  const before = await page.evaluate(() => JSON.stringify(window.__decker.store.getState().positions));
  const started = Date.now();
  deck.write(
    'src/catalog/products.ts',
    `${deck.read('src/catalog/products.ts')}\n/** Pick the products to show on the front page. */\nexport function featured(products: Product[]): Product[] {\n  return products.slice(0, 3);\n}\n`,
  );
  await expect(block(page, 'Products')).toContainText('Pick the products to show on the front page', {
    timeout: 10_000,
  });
  const elapsed = Date.now() - started;
  console.log(`  measured: map update after a one-file edit ${elapsed} ms`);
  expect(elapsed).toBeLessThan(2000);
  expect(await page.evaluate(() => JSON.stringify(window.__decker.store.getState().positions))).toBe(before);
  deck.git('checkout', '--', 'src/catalog/products.ts');
  await expect(block(page, 'Products')).not.toContainText('front page', { timeout: 10_000 });
});

test('ids, layout and authored bullets survive a file rename and a function rename', async ({ page }) => {
  await deck.open(page);
  const pricing = await idOf(page, 'Pricing');
  // Place the block by hand and give it an authored bullet.
  await flyTo(page, 'Pricing');
  await page.keyboard.press('Escape');
  const box = (await block(page, 'Pricing').boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 14);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 80, { steps: 8 });
  await page.mouse.up();
  const placed = await page.evaluate((id) => window.__decker.store.getState().positions[id], pricing);
  await deck.api('/api/notes', {
    method: 'PATCH',
    body: JSON.stringify({
      version: 1,
      dismissed: [],
      bullets: {
        [pricing]: [{ id: 'bul_authored1', text: 'Prices never include shipping', origin: 'authored' }],
      },
    }),
  });
  await page.waitForTimeout(600);

  // Rename the file. Git reports the rename, so the block keeps its identity.
  deck.git('mv', 'src/orders/pricing.ts', 'src/orders/price-rules.ts');
  deck.write(
    'src/orders/index.ts',
    deck.read('src/orders/index.ts').replace("from './pricing'", "from './price-rules'"),
  );
  deck.write(
    'src/orders/pricing.test.ts',
    deck.read('src/orders/pricing.test.ts').replace("from './pricing'", "from './price-rules'"),
  );
  await expect(block(page, 'PriceRules')).toHaveCount(1, { timeout: 15_000 });
  expect(await idOf(page, 'PriceRules')).toBe(pricing);
  await expect(block(page, 'Pricing')).toHaveCount(0);
  expect(await page.evaluate((id) => window.__decker.store.getState().positions[id], pricing)).toEqual(
    placed,
  );
  await expect(
    block(page, 'PriceRules')
      .locator('.dd-bullet', { hasText: 'Prices never include shipping' })
      .locator('.dd-mark'),
  ).toHaveAttribute('data-o', 'authored');
  // Its tests still hang off it.
  await expect(block(page, 'PriceRules').getByTestId('tests-chip')).toHaveText(/3/);

  // Rename a function. The same body under a new name is only suggested; the engineer confirms it.
  const opId = (name: string) =>
    page.evaluate((n) => {
      const st = window.__decker.store.getState();
      return st.index.snapshot.nodes.find(
        (x: { kind: string; name: string }) => x.kind === 'operation' && x.name === n,
      )?.id as string | undefined;
    }, name);
  const original = await opId('lineTotal');
  expect(original).toBeTruthy();
  for (const file of ['src/orders/price-rules.ts', 'src/orders/pricing.test.ts'])
    deck.write(file, deck.read(file).replaceAll('lineTotal', 'linePrice'));
  await expect(page.getByTestId('renames')).toContainText('lineTotal', { timeout: 15_000 });
  await expect(page.getByTestId('renames')).toContainText('linePrice');
  expect(await opId('linePrice')).not.toBe(original);
  await page.getByTestId('rename-confirm').click();
  await expect(page.getByTestId('renames')).toHaveCount(0);
  await expect.poll(() => opId('linePrice')).toBe(original);
});

test('with a model configured, summaries stream in and are labeled; without one the map already worked', async ({
  page,
}) => {
  // A stand-in for any OpenAI-compatible endpoint, including a local one.
  let calls = 0;
  const model: Server = createServer((req, res) => {
    let text = '';
    req.on('data', (c) => {
      text += c;
    });
    req.on('end', () => {
      calls += 1;
      const name = (JSON.parse(text).messages[1].content as string).match(/Block "(\w+)"/)?.[1] ?? 'This';
      const content = JSON.stringify({
        summary: `${name}, summarized`,
        bullets: [{ text: `Guards ${name} against bad input`, startLine: 3, endLine: 5 }],
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', () => resolve()));
  const port = (model.address() as { port: number }).port;
  try {
    const settings = JSON.parse(deck.read('.deck/deck.json'));
    settings.summarizer = { endpoint: `http://127.0.0.1:${port}/v1`, model: 'local-test', format: 'openai' };
    deck.write('.deck/deck.json', JSON.stringify(settings, null, 2));
    await deck.restart();
    await deck.open(page);
    await flyTo(page, 'Cart');
    const bullet = page.getByTestId('panel-bullet').filter({ hasText: 'Guards Cart against bad input' });
    await expect(bullet).toBeVisible({ timeout: 30_000 });
    await expect(bullet).toContainText('AI summary');
    await expect(bullet.locator('.dd-mark')).toHaveAttribute('data-o', 'summarized');
    await expect(block(page, 'Cart').locator('.dd-mark[data-o="summarized"]').first()).toBeVisible();
    // Pinning makes it authored; unchanged code is never summarized twice.
    await bullet.hover();
    await bullet.getByTitle('Keep this as an authored bullet').click();
    await expect(
      page
        .getByTestId('panel-bullet')
        .filter({ hasText: 'Guards Cart against bad input' })
        .locator('.dd-mark'),
    ).toHaveAttribute('data-o', 'authored');
    // The simple view's descriptions are asked for after the blocks'. Wait for the model to go quiet.
    await expect
      .poll(async () => {
        const n = calls;
        await page.waitForTimeout(800);
        return calls === n;
      })
      .toBe(true);
    const made = calls;
    expect(made).toBeGreaterThan(10);
    await deck.restart();
    await deck.open(page);
    await page.waitForTimeout(1500);
    expect(calls).toBe(made);
  } finally {
    model.close();
  }
  await expect(canvas(page)).toBeVisible();
  await ready(page);
});
