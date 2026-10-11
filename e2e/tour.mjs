// Drives the demo through the API and saves screenshots of each stage, for looking at the design.
//   node e2e/tour.mjs <out-dir>
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const out = path.resolve(process.argv[2] ?? 'test-results/tour');
mkdirSync(out, { recursive: true });
const root = path.resolve('.e2e-tmp/tour');
rmSync(root, { recursive: true, force: true });
mkdirSync('.e2e-tmp', { recursive: true });
cpSync('examples/shop', root, {
  recursive: true,
  filter: (s) => !/[\\/](node_modules|cache)$/.test(s) && !/\.deck[\\/](ids|layout|notes)\.json$/.test(s),
});
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
git('init', '-q', '-b', 'main');
git('config', 'user.name', 'tour');
git('config', 'user.email', 'tour@localhost');
git('config', 'core.autocrlf', 'false');
git('add', '-A');
git('commit', '-q', '-m', 'The reference service');

const port = 4764;
const proc = spawn(
  process.execPath,
  [
    'packages/server/bin/decker.mjs',
    root,
    '--no-open',
    '--port',
    String(port),
    '--token',
    'tour',
    '--sandbox',
    'host',
    '--worker',
    'scripted',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (route, init = {}) =>
  (
    await fetch(`http://127.0.0.1:${port}${route}`, {
      ...init,
      headers: { authorization: 'Bearer tour', 'content-type': 'application/json' },
    })
  ).json();
const until = async (id, state) => {
  for (let i = 0; i < 300; i++) {
    const c = (await api('/api/deck')).changes.find((x) => x.id === id);
    if (c?.state === state) return c;
    if (c?.state === 'failed') throw new Error(c.error);
    await sleep(500);
  }
  throw new Error(`never reached ${state}`);
};

try {
  await sleep(4000);
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const shot = async (name) => {
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(out, `${name}.png`) });
  };
  await page.goto(`http://127.0.0.1:${port}/?t=tour`);
  await page.waitForSelector('[data-testid="app"][data-status="ready"]');
  await page.waitForTimeout(1500);
  await api('/api/checks', { method: 'POST', body: '{}' });
  await sleep(9000);
  await shot('1-map');

  const deck = await api('/api/deck');
  const block = (name) => deck.snapshot.nodes.find((n) => n.kind === 'block' && n.name === name).id;
  const ops = [
    {
      id: 'cop_reserve',
      type: 'add_edge',
      from: block('Orders'),
      to: block('Inventory'),
      kind: 'api',
      label: 'Reserve stock',
      bullets: [
        'Reserve every item before confirming an order',
        'Never reserve only part of an order',
        'Retrying the same request must not reserve stock twice',
        'Return which items are unavailable',
      ],
    },
  ];
  await api('/api/changes/chg_tour', {
    method: 'PATCH',
    body: JSON.stringify({ title: 'Reserve stock for an order', operations: ops }),
  });
  await page.reload();
  await page.waitForSelector('[data-testid="app"][data-status="ready"]');
  await page.waitForTimeout(1200);
  await page.evaluate(
    ([a, b]) => window.__decker.camera.flyTo([a, b]),
    [block('Orders'), block('Inventory')],
  );
  await page.getByTestId('changes').click();
  await shot('2-requested');

  await api('/api/changes/chg_tour/submit', { method: 'POST', body: '{}' });
  await until('chg_tour', 'needs_answer');
  await shot('3-plan');
  await api('/api/changes/chg_tour/plan', {
    method: 'PATCH',
    body: JSON.stringify({ answers: { q_expiry: 'No expiry', q_persistence: 'In memory' } }),
  });
  await api('/api/changes/chg_tour/approve', { method: 'POST', body: '{}' });
  await until('chg_tour', 'in_review');
  await page.evaluate(() => window.__decker.store.getState().enterReview('chg_tour'));
  await shot('4-review-contradicted');
  await page.evaluate(() => {
    const st = window.__decker.store.getState();
    st.select(st.index.blocks.find((b) => b.name === 'Inventory').id);
    st.set({ panelTab: 'diff' });
  });
  await shot('5-review-diff');
  await api('/api/changes/chg_tour/revise', {
    method: 'POST',
    body: JSON.stringify({ comment: 'Check every item before reserving any of them' }),
  });
  await until('chg_tour', 'in_review');
  await page.evaluate(() => window.__decker.store.getState().select(null));
  await page.evaluate(() => window.__decker.store.getState().enterReview('chg_tour'));
  await shot('6-review-ready');
  await api('/api/changes/chg_tour/accept', { method: 'POST', body: '{}' });
  await until('chg_tour', 'accepted');
  await page.evaluate(() => window.__decker.store.getState().exitReview());
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const st = window.__decker.store.getState();
    const link = st.index.links.find(
      (l) => st.index.byId.get(l.from).name === 'Orders' && st.index.byId.get(l.to).name === 'Inventory',
    );
    st.select(link.id);
    window.__decker.camera.flyTo([link.from, link.to]);
  });
  await shot('7-accepted');
  await page.evaluate(() => window.__decker.store.getState().setTheme('light'));
  await shot('8-accepted-light');
  await browser.close();
  console.log(`screenshots in ${out}`);
} finally {
  proc.kill();
}
