// npm run demo
// Copies the reference service into a scratch git repository and starts decker on it.
// The demo commits to that copy when you accept a change, so it never touches this
// repository, and every run starts from the same clean state.
//
//   npm run demo                                   stored candidates, no model
//   npm run demo -- --worker claude --model claude-haiku-5-5 --effort medium
//   npm run demo -- --integration                  also run the tier that reaches the test database
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(repo, '.demo', 'shop');
const integration = process.argv.includes('--integration');
const extra = process.argv.slice(2).filter((a) => a !== '--integration');
// With a real model as the worker, the stored candidates would be an answer key. Leave them out.
const live = extra.includes('--worker') && extra[extra.indexOf('--worker') + 1] !== 'scripted';

rmSync(root, { recursive: true, force: true });
mkdirSync(path.dirname(root), { recursive: true });
cpSync(path.join(repo, 'examples', 'shop'), root, {
  recursive: true,
  filter: (src) =>
    !/[\\/](node_modules|cache)$/.test(src) &&
    !(live && /[\\/]shop[\\/]demo$/.test(src)) &&
    !/[\\/]\.deck[\\/](ids|layout|notes)\.json$/.test(src) &&
    !/[\\/]\.deck[\\/]changes$/.test(src),
});
// The integration tier needs credentials and the network (spec §9.3). The demo leaves it out
// unless asked.
if (!integration) {
  const file = path.join(root, '.deck', 'deck.json');
  const settings = JSON.parse(readFileSync(file, 'utf8'));
  settings.checks = settings.checks.filter((c) => !c.secrets?.length);
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
git('init', '--quiet', '-b', 'main');
git('config', 'user.name', 'Double Decker demo');
git('config', 'user.email', 'demo@localhost');
git('config', 'core.autocrlf', 'false');
git('add', '-A');
git('commit', '--quiet', '-m', 'The reference service');

// The stored candidates need no model. The host sandbox runs their checks on this machine.
const args = [path.join(repo, 'packages', 'server', 'bin', 'decker.mjs'), root];
if (!extra.includes('--worker')) args.push('--worker', 'scripted');
if (!extra.includes('--sandbox')) args.push('--sandbox', 'host');
const child = spawn(process.execPath, [...args, ...extra], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
