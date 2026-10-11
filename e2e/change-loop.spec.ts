// M3 and M4: the change loop on the reference service (spec §6, §9.1, §11).
// The worker replays stored candidates, so every outcome here is deterministic. Checks run
// through the harness in host mode, because this machine has no container runtime.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { cleanup, type Deck, idOf, openTray, requestApi, startDecker, waitForState } from './decker';
import { arrow, block, flyTo } from './helpers';

test.describe.configure({ mode: 'serial' });

let deck: Deck;
test.beforeAll(async () => {
  deck = await startDecker('loop');
});
test.afterAll(async () => cleanup(deck));

const card = (page: Page, title: string | RegExp) => page.getByTestId('change').filter({ hasText: title });
const codeStatus = () => deck.git('status', '--porcelain', '--', '.', ':(exclude).deck');

/** Request a new behavior on a block: "+ Add bullet" in the panel. */
async function requestBullet(page: Page, blockName: string, text: string): Promise<void> {
  await flyTo(page, blockName);
  await page.getByTestId('add-bullet').first().click();
  await page.getByTestId('add-bullet-input').fill(text);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

async function submitAndApprove(page: Page, title: string | RegExp): Promise<void> {
  await openTray(page);
  await card(page, title).getByTestId('submit').click();
  await waitForState(page, title, 'Plan ready', 30_000);
  await card(page, title).getByTestId('approve').click();
}

async function openReview(page: Page, title: string | RegExp): Promise<void> {
  await openTray(page);
  await waitForState(page, title, 'In review');
  await card(page, title).getByTestId('open-review').click();
  await expect(page.getByTestId('review-banner')).toContainText('Reviewing');
}

test('the demo: a requested API, a flawed candidate caught by a harness test, a revision, and acceptance', async ({
  page,
}) => {
  await deck.open(page);
  const orders = await idOf(page, 'Orders');
  const inventory = await idOf(page, 'Inventory');
  // 1. The accepted map shows Orders and Inventory with no reservation interface.
  await expect(arrow(page, orders, inventory)).toHaveCount(0);

  // 2. Drag an arrow from Orders to Inventory, pick API, label it, and add four bullets.
  await requestApi(page, 'Orders', 'Inventory', 'Reserve stock', [
    'Reserve every item before confirming an order',
    'Never reserve only part of an order',
    'Retrying the same request must not reserve stock twice',
    'Return which items are unavailable',
  ]);

  // 3. The arrow appears dashed and "Requested". Nothing has been sent to an agent.
  const requested = arrow(page, orders, inventory);
  await expect(requested).toHaveAttribute('data-s', 'requested');
  expect(
    await requested.locator('.dd-edge-line').evaluate((el) => getComputedStyle(el).strokeDasharray),
  ).not.toBe('none');
  await expect(page.getByTestId('arrow-pill').filter({ hasText: 'Reserve stock' })).toContainText(
    'Requested',
  );
  const title = /Reserve stock/;
  await openTray(page);
  await expect(card(page, title).getByTestId('change-state')).toHaveText('Draft');
  await card(page, title).getByTestId('as-text').click();
  await expect(card(page, title).getByTestId('deck-text')).toContainText('-> Inventory: API Reserve stock');
  await expect(card(page, title).getByTestId('deck-text')).toContainText(
    '▪ Never reserve only part of an order',
  );
  await card(page, title).getByTestId('as-text').click();

  // 4. The plan: an interface, a checklist with a test for each requirement, and two questions.
  await card(page, title).getByTestId('submit').click();
  await waitForState(page, title, 'Needs your answer', 30_000);
  const plan = card(page, title).getByTestId('plan');
  await expect(plan).toContainText('reserve(orderId, items, idempotencyKey)');
  await expect(plan.getByTestId('requirement')).toHaveCount(4);
  await expect(plan.getByTestId('question')).toHaveCount(2);
  await expect(plan.getByTestId('approve')).toBeDisabled();
  await plan.getByTestId('question').nth(0).getByRole('button', { name: 'No expiry' }).click();
  await plan.getByTestId('question').nth(1).getByRole('button', { name: 'In memory' }).click();
  await plan.getByTestId('approve').click();

  // 5. The first candidate reserves items one at a time. The harness, not the agent, finds the partial reservation.
  await openReview(page, title);
  await expect(page.getByTestId('review-banner')).toContainText('candidate 1');
  await expect(page.getByTestId('accept')).toBeDisabled();
  const contradicted = page.locator('[data-testid="finding"][data-kind="contradicted"]');
  await expect(contradicted).toHaveCount(1);
  await expect(contradicted).toContainText('When any item is short, nothing is reserved');
  await expect(contradicted).toContainText('reserves nothing when one item is short');
  await expect(page.getByTestId('review-blockers')).toContainText('Contradicted');
  await expect(page.locator('[data-testid="finding"][data-kind="supported"]')).toHaveCount(3);
  await expect(page.locator('[data-testid="finding"][data-kind="implemented"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="check"]').filter({ hasText: 'tests' })).toContainText('Failed');
  await expect(page.locator('[data-testid="check"]').filter({ hasText: 'typecheck' })).toContainText(
    'Passed',
  );
  // The agent said "All tests pass". That is shown nowhere as evidence.
  await expect(page.getByTestId('review-panel')).not.toContainText('All tests pass');

  // On the map: the new arrow is real now (solid), and the block that broke the requirement says so.
  await expect(arrow(page, orders, inventory)).toHaveAttribute('data-s', 'implemented');
  expect(
    await arrow(page, orders, inventory)
      .locator('.dd-edge-line')
      .evaluate((el) => getComputedStyle(el).strokeDasharray),
  ).toBe('none');
  await expect(block(page, 'Inventory').getByTestId('badge-contradicted')).toBeVisible();
  // The chip shows the failure the harness found, and flags the tests the agent added.
  await expect(block(page, 'Inventory').getByTestId('tests-chip')).toContainText('✕1/11');
  await expect(block(page, 'Inventory').getByTestId('tests-chip')).toContainText('+5 new');
  await expect(block(page, 'StockStore')).toHaveClass(/dd-unchanged/);
  // The new arrow carries the tests its requirements named: one of the four is failing.
  const reviewPill = page.getByTestId('arrow-pill').filter({ hasText: 'Reserve stock' });
  await expect(reviewPill.getByTestId('arrow-tests')).toHaveText('✕1/4');
  // Holding B shows the map before the change.
  await page.keyboard.down('b');
  await expect(page.getByTestId('review-banner')).toContainText('Before the change');
  await expect(arrow(page, orders, inventory)).toHaveCount(0);
  await page.keyboard.up('b');
  await expect(arrow(page, orders, inventory)).toHaveCount(1);
  // Each changed element has its code diff.
  await block(page, 'Inventory').click();
  await page.getByTestId('tab-diff').click();
  await expect(page.getByTestId('diff')).toContainText(
    'reserve(orderId: OrderId, items: LineItem[], idempotencyKey: string)',
  );
  await page.keyboard.press('Escape');

  // 6. Revise. The second candidate passes, and Accept merges it.
  const before = deck.git('rev-parse', 'HEAD');
  await page.getByTestId('revise').click();
  await page.getByTestId('revise-input').fill('Check every item before reserving any of them');
  await page.keyboard.press('Enter');
  await openReview(page, title);
  await expect(page.getByTestId('review-banner')).toContainText('candidate 2');
  await expect(page.locator('[data-testid="finding"][data-kind="contradicted"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="finding"][data-kind="supported"]')).toHaveCount(4);
  await expect(page.getByTestId('review-blockers')).toHaveCount(0);
  expect(deck.git('rev-parse', 'HEAD')).toBe(before);
  await page.getByTestId('accept').click();
  await expect(page.getByTestId('review-banner')).toHaveCount(0);
  await openTray(page);
  await waitForState(page, title, 'Accepted', 30_000);

  // The accepted arrow is the resting state: solid, uncolored, with the intent the engineer wrote.
  const accepted = arrow(page, orders, inventory);
  await expect(accepted).toHaveCount(1);
  await expect(accepted).not.toHaveAttribute('data-s', /.+/);
  const pill = page.getByTestId('arrow-pill').filter({ hasText: 'API · Reserve stock' });
  await expect(pill).toBeVisible();
  await expect(pill).not.toContainText('Requested');
  await page.keyboard.press('Escape');
  await pill.click();
  await expect(
    page
      .getByTestId('panel-bullet')
      .filter({ hasText: 'Never reserve only part of an order' })
      .locator('.dd-mark'),
  ).toHaveAttribute('data-o', 'authored');
  await expect(page.getByTestId('panel')).toContainText('Limit: Should a reservation expire? No expiry');
  await expect(page.getByTestId('panel')).toContainText('Limit: Where are reservations kept? In memory');
  // The arrow keeps the tests that were linked to its requirements, behind a chip on its pill.
  await expect(pill.getByTestId('arrow-tests')).toHaveText('✓4');
  await expect(page.getByTestId('panel-test')).toHaveCount(4);
  await expect(
    page.getByTestId('panel-test').filter({ hasText: 'reserves nothing when one item is short' }),
  ).toBeVisible();
  // Tests chips come from the harness run on exactly this code.
  await expect(block(page, 'Inventory').getByTestId('tests-chip')).toHaveText('✓11');
  // The lower deck: real commits on the working branch, and a clean tree.
  expect(deck.read('src/inventory/index.ts')).toContain('Check the whole order before touching stock');
  expect(deck.git('log', '--format=%s')).toContain('(candidate 2)');
  expect(deck.git('log', '--merges', '--format=%s')).toBe('');
  expect(codeStatus()).toBe('');
});

test('an edit nobody asked for is marked Unrequested, and Reject leaves the working tree untouched', async ({
  page,
}) => {
  await deck.open(page);
  const head = deck.git('rev-parse', 'HEAD');
  await requestBullet(page, 'Inventory', 'Warn about low stock');
  await submitAndApprove(page, /low stock/);
  await openReview(page, /low stock/);
  const unrequested = page.locator('[data-testid="finding"][data-kind="unrequested"]');
  await expect(unrequested).toHaveCount(1);
  await expect(unrequested).toContainText('Changed Products');
  await unrequested.click();
  await expect(block(page, 'Products').getByTestId('badge-unrequested')).toBeVisible();
  await expect(block(page, 'Inventory').getByTestId('badge-unrequested')).toHaveCount(0);

  const worktrees = path.join(deck.root, '.deck', 'cache', 'worktrees');
  expect(deck.git('worktree', 'list')).toContain('worktrees');
  await page.getByTestId('reject').click();
  await openTray(page);
  await waitForState(page, /low stock/, 'Rejected', 30_000);
  expect(deck.git('rev-parse', 'HEAD')).toBe(head);
  expect(codeStatus()).toBe('');
  expect(deck.read('src/inventory/index.ts')).not.toContain('isLow');
  expect(deck.git('worktree', 'list').split('\n')).toHaveLength(1);
  expect(existsSync(worktrees) ? readdirSync(worktrees) : []).toEqual([]);
  // The request is kept on record.
  expect(deck.git('status', '--porcelain', '--', '.deck/changes')).not.toBe('');
});

test('a test the agent deleted is flagged on the tests chip in review', async ({ page }) => {
  await deck.open(page);
  await flyTo(page, 'Inventory');
  await block(page, 'Inventory')
    .locator('.dd-bullet-text', { hasText: 'Adjust stock by hand, never below zero' })
    .click();
  await block(page, 'Inventory')
    .locator('input.dd-inline-edit')
    .fill('Adjust stock by hand, allowing a negative balance');
  await page.keyboard.press('Enter');
  await submitAndApprove(page, /negative/);
  await openReview(page, /negative/);
  await expect(block(page, 'Inventory').getByTestId('tests-chip')).toContainText('1 deleted');
  await expect(block(page, 'Inventory').getByTestId('tests-chip')).toContainText('+1 new');
  await expect(page.locator('[data-testid="test-delta"][data-kind="deleted"]')).toContainText(
    'never lets stock go below zero',
  );
  await expect(page.locator('[data-testid="finding"][data-kind="supported"]')).toContainText(
    'Stock may go below zero',
  );
  await page.getByTestId('reject').click();
  await openTray(page);
  await waitForState(page, /negative/, 'Rejected', 30_000);
});

test('two changes run in parallel worktrees; accepting the second after the base moved forces a rebase and a re-check', async ({
  page,
}) => {
  await deck.open(page);
  await requestBullet(page, 'Catalog', 'Search products by name');
  await submitAndApprove(page, /Search products/);
  await requestBullet(page, 'Inventory', 'Warn about low stock again');
  await submitAndApprove(page, /low stock again/);
  await waitForState(page, /Search products/, 'In review');
  await waitForState(page, /low stock again/, 'In review');
  expect(deck.git('worktree', 'list').split('\n')).toHaveLength(3);

  await card(page, /Search products/)
    .getByTestId('open-review')
    .click();
  await page.getByTestId('accept').click();
  await openTray(page);
  await waitForState(page, /Search products/, 'Accepted', 30_000);
  const moved = deck.git('rev-parse', 'HEAD');

  // The second candidate was built on the old base. Accept refuses, rebases, and checks again.
  await card(page, /low stock again/)
    .getByTestId('open-review')
    .click();
  await page.getByTestId('accept').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'The base had moved' })).toBeVisible({
    timeout: 120_000,
  });
  expect(deck.git('rev-parse', 'HEAD')).toBe(moved);
  await openReview(page, /low stock again/);
  await page.getByTestId('accept').click();
  await openTray(page);
  await waitForState(page, /low stock again/, 'Accepted', 30_000);

  expect(deck.git('log', '--merges', '--format=%s')).toBe('');
  expect(deck.read('src/catalog/index.ts')).toContain('search(text: string)');
  expect(deck.read('src/inventory/index.ts')).toContain('isLow(sku: Sku)');
  expect(codeStatus()).toBe('');
  await flyTo(page, 'Catalog');
  await expect(
    page.getByTestId('panel-bullet').filter({ hasText: 'Search products by name' }).first(),
  ).toBeVisible();
});

test('an accepted change is reverted through a revert candidate and the same review', async ({ page }) => {
  await deck.open(page);
  await openTray(page);
  await card(page, /^Add “Search products by name”/)
    .getByTestId('revert')
    .click();
  await openReview(page, /Revert: /);
  await expect(page.locator('[data-testid="finding"]').filter({ hasText: 'Restores Catalog' })).toBeVisible();
  await page.getByTestId('accept').click();
  await openTray(page);
  await waitForState(page, /Revert: /, 'Accepted', 30_000);
  expect(deck.read('src/catalog/index.ts')).not.toContain('search(text: string)');
  expect(deck.read('src/inventory/index.ts')).toContain('isLow(sku: Sku)');
  await flyTo(page, 'Catalog');
  await expect(page.getByTestId('panel-op').filter({ hasText: 'search(' })).toHaveCount(0);
});

test('stopping the server mid-run marks the change failed and never leaves the working branch half-changed', async ({
  page,
}) => {
  await deck.open(page);
  await requestBullet(page, 'Ids', 'Read the prefix slowly');
  await submitAndApprove(page, /slowly/);
  await waitForState(page, /slowly/, 'Implementing', 30_000);
  await expect(card(page, /slowly/).getByTestId('progress')).toContainText('Applying stored candidate', {
    timeout: 20_000,
  });
  const head = deck.git('rev-parse', 'HEAD');
  await deck.stop();
  expect(deck.git('rev-parse', 'HEAD')).toBe(head);
  expect(codeStatus()).toBe('');

  await deck.restart();
  await deck.open(page);
  await openTray(page);
  await waitForState(page, /slowly/, 'Failed', 30_000);
  await expect(card(page, /slowly/)).toContainText(
    'The server stopped while implementing. Nothing was merged.',
  );
  expect(deck.git('worktree', 'list').split('\n')).toHaveLength(1);
  // It can be tried again, and this time it gets to review.
  await card(page, /slowly/)
    .getByTestId('retry')
    .click();
  await waitForState(page, /slowly/, 'In review');
  await card(page, /slowly/)
    .getByTestId('open-review')
    .click();
  await page.getByTestId('reject').click();
  expect(deck.git('rev-parse', 'HEAD')).toBe(head);
});
