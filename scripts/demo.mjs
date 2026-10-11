// npm run demo
// Copies the reference service into a scratch git repository and starts decker on it.
// The demo commits to that copy when you accept a change, so it never touches this
// repository, and every run starts from the same clean state.
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(repo, '.demo', 'shop');

rmSync(root, { recursive: true, force: true });
mkdirSync(path.dirname(root), { recursive: true });
cpSync(path.join(repo, 'examples', 'shop'), root, {
  recursive: true,
  filter: (src) =>
    !/[\\/](node_modules|cache)$/.test(src) &&
    !/[\\/]\.deck[\\/](ids|layout|notes)\.json$/.test(src) &&
    !/[\\/]\.deck[\\/]changes$/.test(src),
});
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
git('init', '--quiet', '-b', 'main');
git('config', 'user.name', 'Double Decker demo');
git('config', 'user.email', 'demo@localhost');
git('config', 'core.autocrlf', 'false');
git('add', '-A');
git('commit', '--quiet', '-m', 'The reference service');

// The stored candidates need no model. The host sandbox runs their checks on this machine.
const extra = process.argv.slice(2);
const args = [path.join(repo, 'packages', 'server', 'bin', 'decker.mjs'), root, '--worker', 'scripted'];
if (!extra.includes('--sandbox')) args.push('--sandbox', 'host');
const child = spawn(process.execPath, [...args, ...extra], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
