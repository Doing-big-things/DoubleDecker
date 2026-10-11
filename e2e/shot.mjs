// Take a full-resolution screenshot of the running app, for looking at the design.
//   node e2e/shot.mjs <url> <out.png> [--w 1440] [--h 900] [--scale 1] [--eval "js"] [--wait 800] [--theme light]
import { chromium } from '@playwright/test';

const [url, out, ...rest] = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : fallback;
};
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({
  viewport: { width: Number(opt('w', 1440)), height: Number(opt('h', 900)) },
  deviceScaleFactor: Number(opt('scale', 1)),
  colorScheme: 'dark',
});
page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()));
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.goto(url);
await page.waitForSelector('[data-testid="app"][data-status="ready"]', { timeout: 20000 });
await page.waitForTimeout(1200);
if (opt('theme')) await page.evaluate((t) => window.__decker.store.getState().setTheme(t), opt('theme'));
const code = opt('eval');
if (code) console.log('eval:', JSON.stringify(await page.evaluate(`(async () => { ${code} })()`)));
await page.waitForTimeout(Number(opt('wait', 900)));
await page.screenshot({ path: out });
await browser.close();
