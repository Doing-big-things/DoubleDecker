// The simple view on real code, and requests made in plain words going through the whole
// change loop (spec §3.13, §6). The reference service is extracted for real, and the worker
// replays stored candidates, so every outcome is deterministic.
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { expect, type Page, test } from '@playwright/test';
import { cleanup, type Deck, openTray, startDecker, waitForState } from './decker';
import { part } from './helpers';

test.describe.configure({ mode: 'serial' });

let deck: Deck;
test.beforeAll(async () => {
  deck = await startDecker('plain');
});
test.afterAll(async () => cleanup(deck));

const card = (page: Page, title: string | RegExp) => page.getByTestId('change').filter({ hasText: title });
const label = (page: Page, text: string | RegExp) =>
  page.getByTestId('connection-label').filter({ hasText: text });
const partId = (page: Page, name: string): Promise<string> =>
  page.evaluate((n) => {
    const hit = window.__decker.store.getState().simple.parts.find((p: { name: string }) => p.name === n);
    if (!hit) throw new Error(`no part named ${n}`);
    return hit.id as string;
  }, name);
const connection = (page: Page, from: string, to: string) =>
  page.locator(`[data-testid="connection"][data-from="${from}"][data-to="${to}"]`);
const codeStatus = () => deck.git('status', '--porcelain', '--', '.', ':(exclude).deck');

test('on real code the simple view is made from the code itself, and says where each line came from', async ({
  page,
}) => {
  await deck.open(page, 'simple');
  await expect(page.getByTestId('view-toggle')).toHaveText('Simple');
  await expect(page.getByTestId('part')).toHaveCount(6);

  // What a part is for: the doc comment of the block that leads it.
  await expect(part(page, 'Catalog').getByTestId('part-summary')).toHaveText('What the shop sells');
  await expect(part(page, 'Orders').getByTestId('part-summary')).toHaveText(
    'Places, tracks and cancels customer orders',
  );
  // No block leads HTTP. The one whose summary names the area speaks for it.
  await expect(part(page, 'HTTP').getByTestId('part-summary')).toHaveText('The HTTP surface of the shop');
  // What a part does: sentences people wrote in the code, what other parts ask for first.
  await expect(part(page, 'Orders').getByTestId('part-row')).toHaveText([
    'Place an order from a cart',
    'Look up one order',
    'Cancel an order and refund the customer',
    "List a customer's orders, newest first",
  ]);
  // Helpers behind a part's face are left out: Inventory's stores are not what it is for.
  await expect(part(page, 'Inventory').getByTestId('part-row')).toHaveText([
    'Report how many units can be sold',
    'Add a delivery to stock',
    'Adjust stock by hand, never below zero',
  ]);
  await expect(part(page, 'Shared')).toHaveClass(/is-bar/);
  // Four of the other five parts use it. HTTP does not, and is not said to.
  await expect(part(page, 'Shared').getByTestId('part-used-by')).toHaveText(/^Used by \w+, \w+ and 2 more$/);
  await expect(part(page, 'Shared').getByTestId('part-used-by')).not.toContainText('HTTP');

  // What a connection carries: the operations one part calls on the other, in a few words.
  const [http, orders, payments, catalog] = await Promise.all(
    ['HTTP', 'Orders', 'Payments', 'Catalog'].map((n) => partId(page, n)),
  );
  await expect(page.getByTestId('connection')).toHaveCount(5);
  await expect(connection(page, http!, orders!)).toHaveCount(1);
  await expect(label(page, 'place, get and cancel orders')).toBeVisible();
  await expect(label(page, 'charge and refund')).toBeVisible();
  await expect(label(page, 'gets catalog information')).toBeVisible();
  await expect(connection(page, orders!, catalog!)).toHaveCount(1);
  // HTTP builds Payments when the service starts and asks nothing of it. That is wiring: no line.
  await expect(connection(page, http!, payments!)).toHaveCount(0);

  // The panel says where each line came from, and what a part only puts together.
  await part(page, 'HTTP').locator('.dd-part-name').click();
  await expect(page.getByTestId('panel-summary')).toContainText('from a comment in the code');
  await expect(page.getByTestId('panel')).toContainText(
    'Also puts together Payments when the system starts.',
  );
  await label(page, 'charge and refund').click();
  await expect(page.getByTestId('panel-name')).toHaveText('Orders → Payments');
  await expect(page.getByTestId('panel-label')).toContainText('from names in the code');
  await expect(page.getByTestId('panel-line')).toHaveText([
    /Charge a customer for an order/,
    /Give the money for a payment back/,
  ]);
  await expect(page.getByTestId('panel')).toContainText('2 places in the code where Orders calls Payments');
});

test('a request in plain words goes through the loop: a plan, a candidate, a review on the same picture, and acceptance', async ({
  page,
}) => {
  await deck.open(page, 'simple');
  const ask = 'Let customers search for products by name';
  await part(page, 'Catalog').getByTestId('part-ask').click();
  await page.getByTestId('part-ask-input').fill(ask);
  await page.keyboard.press('Enter');
  await expect(part(page, 'Catalog').getByTestId('part-work')).toHaveText('1 request not sent');

  // The flag on the card leads to the change. Submit, read the plan, approve it.
  await part(page, 'Catalog').getByTestId('part-work').click();
  await expect(page.getByTestId('tray')).toBeVisible();
  const title = /search for products/;
  await card(page, title).getByTestId('submit').click();
  await waitForState(page, title, 'Plan ready', 30_000);
  await expect(card(page, title).getByTestId('plan')).toContainText(
    'Catalog gains a search over product names',
  );
  await expect(part(page, 'Catalog').getByTestId('part-work')).toHaveText('Waiting for you');
  await card(page, title).getByTestId('approve').click();

  // The card says when there is something to look at, and takes you to it.
  await page.keyboard.press('Escape');
  await expect(part(page, 'Catalog').getByTestId('part-work')).toHaveText('Ready to review', {
    timeout: 150_000,
  });
  await part(page, 'Catalog').getByTestId('part-work').click();
  await expect(page.getByTestId('review-banner')).toContainText('Reviewing');

  // Review on the same picture: the part that changed stands out, the rest steps back.
  await expect(part(page, 'Catalog').getByTestId('badge-changed')).toBeVisible();
  await expect(part(page, 'Catalog')).not.toHaveClass(/dd-unchanged/);
  await expect(part(page, 'Payments')).toHaveClass(/dd-unchanged/);
  await expect(part(page, 'Orders')).toHaveClass(/dd-unchanged/);
  // Nothing was changed that the request does not explain.
  await expect(page.locator('[data-testid="finding"][data-kind="unrequested"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="finding"][data-kind="supported"]')).toHaveCount(1);

  const before = deck.git('rev-parse', 'HEAD');
  await page.getByTestId('accept').click();
  await expect(page.getByTestId('review-banner')).toHaveCount(0);
  await openTray(page);
  await waitForState(page, title, 'Accepted', 30_000);
  await page.keyboard.press('Escape');

  // The words that were asked for stay on the part, as a person's words, and nothing is pending.
  const kept = part(page, 'Catalog').locator('[data-testid="part-row"].is-asked');
  await expect(kept).toHaveText(ask);
  await expect(part(page, 'Catalog').locator('[data-testid="part-row"][data-state="requested"]')).toHaveCount(
    0,
  );
  await expect(part(page, 'Catalog').getByTestId('part-work')).toHaveCount(0);
  // The lower deck: real code on the working branch, and a clean tree.
  expect(deck.git('rev-parse', 'HEAD')).not.toBe(before);
  expect(deck.read('src/catalog/index.ts')).toContain('search(');
  expect(deck.read('.deck/notes.json')).toContain(ask);
  expect(codeStatus()).toBe('');
});

test('a connection asked for between two parts: the flawed candidate is caught, the revision is accepted, and the line keeps its words', async ({
  page,
}) => {
  await deck.open(page, 'simple');
  const [orders, inventory] = await Promise.all(['Orders', 'Inventory'].map((n) => partId(page, n)));
  await expect(connection(page, orders!, inventory!)).toHaveCount(0);

  // Draw the line and say what it is for.
  const words = 'reserve stock for every item before an order is confirmed';
  await part(page, 'Orders').hover();
  const port = (await part(page, 'Orders').locator('.dd-port').nth(1).boundingBox())!;
  const target = (await part(page, 'Inventory').boundingBox())!;
  await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.getByTestId('connection-text').fill(words);
  await page.getByTestId('connection-submit').click();
  const line = connection(page, orders!, inventory!);
  await expect(line).toHaveAttribute('data-s', 'requested');
  await expect(label(page, words)).toHaveAttribute('data-s', 'requested');

  // What the agent is told: a connection between two areas, in the asker's words.
  const title = /Connect Orders to Inventory/;
  await openTray(page);
  await card(page, title).getByTestId('as-text').click();
  await expect(card(page, title).getByTestId('deck-text')).toContainText(`-> Inventory: ${words}`);
  await expect(card(page, title).getByTestId('deck-text')).toContainText('[requested between these areas]');
  await card(page, title).getByTestId('as-text').click();

  // The plan asks two questions before anything is built.
  await card(page, title).getByTestId('submit').click();
  await waitForState(page, title, 'Needs your answer', 30_000);
  const plan = card(page, title).getByTestId('plan');
  await plan.getByTestId('question').nth(0).getByRole('button', { name: 'No expiry' }).click();
  await plan.getByTestId('question').nth(1).getByRole('button', { name: 'In memory' }).click();
  await plan.getByTestId('approve').click();
  await page.keyboard.press('Escape');

  // Candidate 1 builds the connection and breaks a requirement. The harness finds it, and
  // the picture says which part it is in.
  await expect(part(page, 'Orders').getByTestId('part-work')).toHaveText('Ready to review', {
    timeout: 150_000,
  });
  await part(page, 'Orders').getByTestId('part-work').click();
  await expect(page.getByTestId('review-banner')).toContainText('candidate 1');
  await expect(line).toHaveAttribute('data-s', 'implemented');
  expect(
    await line
      .locator('.dd-edge-line')
      .first()
      .evaluate((el) => getComputedStyle(el).strokeDasharray),
  ).toBe('none');
  await expect(part(page, 'Inventory').getByTestId('badge-contradicted')).toBeVisible();
  await expect(page.getByTestId('accept')).toBeDisabled();
  await expect(page.locator('[data-testid="finding"][data-kind="implemented"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="finding"][data-kind="unrequested"]')).toHaveCount(0);
  await expect(part(page, 'Catalog')).toHaveClass(/dd-unchanged/);

  // Revise. Candidate 2 passes and is accepted.
  await page.getByTestId('revise').click();
  await page.getByTestId('revise-input').fill('Check every item before reserving any of them');
  await page.keyboard.press('Enter');
  await expect(part(page, 'Orders').getByTestId('part-work')).toHaveText('Ready to review', {
    timeout: 150_000,
  });
  await part(page, 'Orders').getByTestId('part-work').click();
  await expect(page.getByTestId('review-banner')).toContainText('candidate 2');
  await expect(part(page, 'Inventory').getByTestId('badge-contradicted')).toHaveCount(0);
  await page.getByTestId('accept').click();
  await expect(page.getByTestId('review-banner')).toHaveCount(0);
  await openTray(page);
  await waitForState(page, title, 'Accepted', 30_000);
  await page.keyboard.press('Escape');

  // The accepted line is the resting state: solid, uncolored, and still in the words it was asked in.
  await expect(line).toHaveCount(1);
  await expect(line).not.toHaveAttribute('data-s', /.+/);
  await expect(label(page, words)).toBeVisible();
  await expect(label(page, words)).not.toHaveAttribute('data-s', /.+/);
  await label(page, words).click();
  await expect(page.getByTestId('panel-name')).toHaveText('Orders → Inventory');
  await expect(page.getByTestId('panel')).toContainText('in the code where Orders calls Inventory');
  expect(deck.read('src/inventory/index.ts')).toContain('Check the whole order before touching stock');
  expect(codeStatus()).toBe('');
});

test('with a model configured, the simple view is written by it in everyday words, and says so', async ({
  page,
}) => {
  // A stand-in for any OpenAI-compatible endpoint. It answers the three questions decker asks:
  // about a file, about a whole area, and about what areas ask of each other.
  let calls = 0;
  const asked: string[] = [];
  const model: Server = createServer((req, res) => {
    let text = '';
    req.on('data', (c) => {
      text += c;
    });
    req.on('end', () => {
      calls += 1;
      const [system, user] = (JSON.parse(text).messages as { content: string }[]).map((m) => m.content);
      let content: unknown = { summary: '', bullets: [] };
      if (system!.includes('one part of a software system')) {
        const name = user!.match(/Part "([\w ]+)"/)?.[1] ?? 'This';
        asked.push(name);
        content = {
          summary: `Looks after ${name.toLowerCase()} for the shop.`,
          does: [`Keeps ${name.toLowerCase()} in order`, 'Answers questions from the other parts'],
        };
      } else if (system!.includes('numbered line')) {
        const labels: Record<string, string> = {};
        for (const m of user!.matchAll(/^(\d+)\. [\w ]+ -> ([\w ]+):/gm))
          labels[m[1]!] = `asks ${m[2]!.toLowerCase()} for what it needs`;
        content = { labels };
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
    });
  });
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', () => resolve()));
  const port = (model.address() as { port: number }).port;
  let plain: Deck | undefined;
  try {
    plain = await startDecker('plain-ai', {
      setup(root) {
        const file = `${root}/.deck/deck.json`;
        const settings = JSON.parse(readFileSync(file, 'utf8'));
        settings.summarizer = {
          endpoint: `http://127.0.0.1:${port}/v1`,
          model: 'local-test',
          format: 'openai',
        };
        writeFileSync(file, JSON.stringify(settings, null, 2));
      },
    });
    await plain.open(page, 'simple');

    // The model's words replace the ones taken from the code, on the cards and on the lines.
    await expect(part(page, 'Orders').getByTestId('part-summary')).toHaveText(
      'Looks after orders for the shop',
      {
        timeout: 30_000,
      },
    );
    await expect(part(page, 'Orders').getByTestId('part-row')).toHaveText([
      'Keeps orders in order',
      'Answers questions from the other parts',
    ]);
    await expect(label(page, 'asks payments for what it needs')).toBeVisible({ timeout: 30_000 });
    await expect(label(page, 'charge and refund')).toHaveCount(0);
    // It was asked about each area once, and shown that area's outline, not its source files.
    expect([...asked].sort()).toEqual(['Catalog', 'HTTP', 'Inventory', 'Orders', 'Payments', 'Shared']);

    // The panel says a model wrote them. They are an interpretation, never evidence.
    await part(page, 'Orders').locator('.dd-part-name').click();
    await expect(page.getByTestId('panel-summary')).toContainText('AI summary');
    await expect(page.getByTestId('panel-line').first()).toContainText('AI summary');
    // A person's words still win.
    await page.getByTestId('panel-summary-edit').click();
    await page.getByTestId('panel-summary-input').fill('Everything about an order, start to finish');
    await page.keyboard.press('Enter');
    await expect(part(page, 'Orders').getByTestId('part-summary')).toHaveText(
      'Everything about an order, start to finish',
    );
    expect(plain.read('.deck/notes.json')).toContain('Everything about an order, start to finish');

    // Nothing that has not changed is asked about twice.
    await expect
      .poll(async () => {
        const n = calls;
        await page.waitForTimeout(800);
        return calls === n;
      })
      .toBe(true);
    const made = calls;
    await plain.restart();
    await plain.open(page, 'simple');
    await expect(part(page, 'Payments').getByTestId('part-summary')).toHaveText(
      'Looks after payments for the shop',
    );
    await expect(part(page, 'Orders').getByTestId('part-summary')).toHaveText(
      'Everything about an order, start to finish',
    );
    await page.waitForTimeout(1500);
    expect(calls).toBe(made);
  } finally {
    model.close();
    await cleanup(plain);
  }
});
