// Measures a first map of a repository the way `decker <path>` produces one, and prints the
// figures recorded in fixtures/repos.json (spec §9.2, §10).
//
//   node scripts/measure-repo.mjs <path-to-repo>
//
// It starts with no cached work each time, executes none of the repository's code, and leaves
// behind no .deck folder that was not there before.
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.resolve(process.argv[2] ?? '.');
const had = existsSync(path.join(target, '.deck'));
rmSync(path.join(target, '.deck', 'cache'), { recursive: true, force: true });

const port = 4760 + Math.floor(Math.random() * 30);
const child = spawn(
  process.execPath,
  [
    path.join(repo, 'packages/server/bin/decker.mjs'),
    target,
    '--no-open',
    '--no-watch',
    '--token',
    'measure',
    '--port',
    String(port),
    '--worker',
    'none',
    '--sandbox',
    'none',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let out = '';
const started = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`decker did not start:\n${out}`)), 600_000);
  const onData = (chunk) => {
    out += chunk.toString();
    const mapped = out.match(/mapped \S+ in (\d+) ms \((\d+) blocks, (\d+) files, extraction (\d+) ms\)/);
    const url = out.match(/decker: (http:\/\/127\.0\.0\.1:\d+)\//);
    if (mapped && url) {
      clearTimeout(timer);
      resolve({ firstMapMs: Number(mapped[1]), extractionMs: Number(mapped[4]), origin: url[1] });
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code) => code && reject(new Error(`decker exited with ${code}:\n${out}`)));
});
try {
  const res = await fetch(`${started.origin}/api/deck`, { headers: { authorization: 'Bearer measure' } });
  const { snapshot: s } = await res.json();
  const count = (kind) => s.nodes.filter((n) => n.kind === kind).length;
  const stats = s.stats ?? {};
  const resolved =
    ((stats.resolvedCallSites + stats.resolvedImports) / Math.max(1, stats.callSites + stats.imports)) * 100;
  console.log(
    JSON.stringify(
      {
        firstMapMs: started.firstMapMs,
        extractionMs: started.extractionMs,
        files: stats.files,
        lines: stats.lines,
        areas: count('area'),
        blocks: count('block'),
        operations: count('operation'),
        tests: s.tests.length,
        testsAttributedByDirectCall: s.tests.filter((t) => t.targets.some((x) => x.via === 'calls')).length,
        gaps: s.gaps.length,
        resolvedPercent: Number(resolved.toFixed(2)),
      },
      null,
      2,
    ),
  );
} finally {
  child.kill();
  if (!had) rmSync(path.join(target, '.deck'), { recursive: true, force: true });
}
