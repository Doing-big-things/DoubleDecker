// The integration tier and the test database (spec §9.3). These tests reach a real Supabase
// project with the credentials in TestDB.env, and are skipped on a machine that has none.
// Nothing here ever prints a credential: the assertions compare, and report only yes or no.
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { cleanup, type Deck, startDecker } from './decker';
import { block, flyTo } from './helpers';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV = path.join(REPO, 'TestDB.env');
test.skip(!existsSync(ENV), 'TestDB.env is not on this machine.');

const secrets = (): { key: string; host: string } => {
  const read = (name: string) =>
    (readFileSync(ENV, 'utf8').match(new RegExp(`^\\s*${name}\\s*=\\s*(.*?)\\s*$`, 'm'))?.[1] ?? '').replace(
      /^["']|["']$/g,
      '',
    );
  return { key: read('SUPABASE_TEST_KEY'), host: new URL(read('SUPABASE_TEST_URL')).host };
};

/** Every file under a folder, as one string. */
function everything(dir: string): string {
  let out = '';
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) out += everything(file);
    else out += readFileSync(file, 'utf8');
  }
  return out;
}

let deck: Deck | undefined;
test.afterEach(async () => {
  await cleanup(deck);
  deck = undefined;
});

test('the integration tier checks the Supabase store against the test database, and the key goes nowhere else', async ({
  page,
}) => {
  deck = await startDecker('tier', { integration: true });
  await deck.open(page);

  // On the map: the store behind the same StockStore interface, and the service it talks to.
  await flyTo(page, 'SupabaseStockStore');
  const chip = block(page, 'SupabaseStockStore').getByTestId('tests-chip');
  await expect(chip).toHaveText('3');
  await expect(page.getByTestId('external').filter({ hasText: 'Supabase' })).toBeVisible();
  await expect(page.getByTestId('panel')).toContainText('Keeps stock in a Supabase Storage bucket');

  // The harness runs the tier with the credentials, against the real project.
  await page.getByTestId('run-checks').click();
  await expect(chip).toHaveText('✓3', { timeout: 120_000 });
  await page.getByTestId('tab-tests').click();
  await expect(
    page.getByTestId('panel-test').filter({ hasText: 'keeps a stock level across a restart' }).first(),
  ).toBeVisible();
  // The ordinary tests ran too, without the credentials.
  await flyTo(page, 'Inventory');
  await expect(block(page, 'Inventory').getByTestId('tests-chip')).toHaveText('✓5');

  // The key and the project's address are in the check's environment and nowhere else.
  const { key, host } = secrets();
  expect(key.length).toBeGreaterThan(10);
  const places: Record<string, string> = {
    'what the browser was sent': JSON.stringify(await deck.api('/api/deck')),
    'the page': await page.content(),
    'the .deck folder': everything(path.join(deck.root, '.deck')),
    'what decker printed': deck.log(),
    'the repository': deck
      .git('ls-files')
      .split(/\r?\n/)
      .map((file) => deck!.read(file))
      .join(' '),
  };
  for (const [where, text] of Object.entries(places)) {
    expect(text.includes(key), `the key reached ${where}`).toBe(false);
    expect(text.includes(host), `the project's address reached ${where}`).toBe(false);
  }
});

test('an unreachable database skips its tests. It never fails them, and never blocks the rest', async ({
  page,
}) => {
  const unreachable = path.join(REPO, '.e2e-tmp', `unreachable-${Date.now().toString(36)}.env`);
  deck = await startDecker('paused', {
    integration: true,
    setup: (root) => {
      // Credentials that point at nothing: a closed port on this machine.
      writeFileSync(unreachable, 'SUPABASE_TEST_URL=http://127.0.0.1:9\nSUPABASE_TEST_KEY=not-a-real-key\n');
      const file = path.join(root, '.deck', 'deck.json');
      const settings = JSON.parse(readFileSync(file, 'utf8'));
      for (const check of settings.checks) if (check.secrets) check.envFile = unreachable;
      writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
    },
  });
  try {
    await deck.open(page);
    await flyTo(page, 'Inventory');
    await page.getByTestId('run-checks').click();
    await expect(block(page, 'Inventory').getByTestId('tests-chip')).toHaveText('✓5', { timeout: 120_000 });

    await flyTo(page, 'SupabaseStockStore');
    const chip = block(page, 'SupabaseStockStore').getByTestId('tests-chip');
    await expect(chip).toHaveText('–3');
    await page.getByTestId('tab-tests').click();
    const rows = page.getByTestId('panel-test');
    await expect(rows.first()).toBeVisible();
    for (const glyph of await rows.locator('.dd-glyph').all())
      await expect(glyph).toHaveAttribute('data-s', 'skipped');
  } finally {
    rmSync(unreachable, { force: true });
  }
});

test('with no credentials on the machine, the tier is skipped and says why', async ({ page }) => {
  deck = await startDecker('nocreds', {
    integration: true,
    setup: (root) => {
      const file = path.join(root, '.deck', 'deck.json');
      const settings = JSON.parse(readFileSync(file, 'utf8'));
      for (const check of settings.checks) if (check.secrets) check.envFile = 'no-such-file.env';
      writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
    },
  });
  await deck.open(page);
  await flyTo(page, 'Inventory');
  await page.getByTestId('run-checks').click();
  await expect(block(page, 'Inventory').getByTestId('tests-chip')).toHaveText('✓5', { timeout: 120_000 });
  await flyTo(page, 'SupabaseStockStore');
  await page.getByTestId('tab-tests').click();
  for (const glyph of await page.getByTestId('panel-test').locator('.dd-glyph').all())
    await expect(glyph).toHaveAttribute('data-s', 'skipped');
});
