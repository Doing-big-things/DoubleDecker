// Starts a real decker server on a throwaway copy of the reference service.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { ready } from './helpers';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(REPO, '.e2e-tmp');

export interface Deck {
  root: string;
  url: string;
  token: string;
  origin: string;
  proc: ChildProcess;
  args: string[];
  stop(): Promise<void>;
  restart(): Promise<void>;
  api<T>(route: string, init?: RequestInit): Promise<T>;
  git(...args: string[]): string;
  read(rel: string): string;
  write(rel: string, text: string): void;
  open(page: Page): Promise<void>;
}

function launch(root: string, args: string[]): Promise<{ proc: ChildProcess; url: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.execPath,
      [path.join(REPO, 'packages/server/bin/decker.mjs'), root, '--no-open', '--token', 'e2e', ...args],
      { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    const timer = setTimeout(() => reject(new Error(`decker did not start:\n${out}`)), 60_000);
    const onData = (chunk: Buffer) => {
      out += chunk.toString();
      const m = out.match(/decker: (http:\/\/127\.0\.0\.1:\d+\/\?t=\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ proc, url: m[1]! });
      }
    };
    proc.stdout!.on('data', onData);
    proc.stderr!.on('data', onData);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code) reject(new Error(`decker exited with ${code}:\n${out}`));
    });
  });
}

/** Copy examples/shop into a fresh git repository and start decker on it. */
export async function startDecker(
  name: string,
  options: { args?: string[]; setup?: (root: string) => void; source?: string } = {},
): Promise<Deck> {
  const root = path.join(TMP, `${name}-${Date.now().toString(36)}`);
  mkdirSync(TMP, { recursive: true });
  cpSync(options.source ?? path.join(REPO, 'examples', 'shop'), root, {
    recursive: true,
    filter: (src) =>
      !/[\\/](node_modules|cache)$/.test(src) &&
      !/[\\/]\.deck[\\/](ids|layout|notes)\.json$/.test(src) &&
      !/[\\/]\.deck[\\/]changes$/.test(src),
  });
  options.setup?.(root);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '--quiet', '-b', 'main');
  git('config', 'user.name', 'E2E');
  git('config', 'user.email', 'e2e@localhost');
  git('config', 'core.autocrlf', 'false');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'The reference service');

  const args = options.args ?? ['--sandbox', 'host', '--worker', 'scripted'];
  const deck = { root, args, token: 'e2e', git } as Deck;
  const boot = async () => {
    const started = await launch(root, deck.args);
    deck.proc = started.proc;
    deck.url = started.url;
    deck.origin = new URL(started.url).origin;
  };
  await boot();
  deck.stop = () =>
    new Promise<void>((resolve) => {
      if (deck.proc.exitCode !== null || deck.proc.signalCode !== null) return resolve();
      deck.proc.once('exit', () => resolve());
      deck.proc.kill();
    });
  deck.restart = async () => {
    await deck.stop();
    await boot();
  };
  deck.api = async <T>(route: string, init: RequestInit = {}) => {
    const res = await fetch(`${deck.origin}${route}`, {
      ...init,
      headers: {
        authorization: `Bearer ${deck.token}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`${route}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };
  deck.read = (rel) => readFileSync(path.join(root, rel), 'utf8');
  deck.write = (rel, text) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  };
  deck.open = async (page) => {
    await page.goto(deck.url);
    await ready(page);
  };
  return deck;
}

export async function cleanup(deck: Deck | undefined): Promise<void> {
  if (!deck) return;
  await deck.stop();
  for (let i = 0; i < 5; i++) {
    try {
      if (existsSync(deck.root)) rmSync(deck.root, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}

/** The id of a block on the page, by name. */
export const idOf = (page: Page, name: string): Promise<string> =>
  page.evaluate((n) => {
    const st = window.__decker.store.getState();
    const node = st.index.blocks.find((b: { name: string }) => b.name === n);
    if (!node) throw new Error(`no block named ${n}`);
    return node.id as string;
  }, name);

/** Wait for a change in the tray to reach a state. */
export async function waitForState(
  page: Page,
  title: RegExp | string,
  state: string,
  timeout = 150_000,
): Promise<void> {
  const card = page.getByTestId('change').filter({ hasText: title });
  await expect(card.getByTestId('change-state')).toHaveText(state, { timeout });
}

export async function openTray(page: Page): Promise<void> {
  if (!(await page.getByTestId('tray').isVisible())) await page.getByTestId('changes').click();
  await expect(page.getByTestId('tray')).toBeVisible();
}
