// Git access. The proof of concept uses git commits as its baseline and its evidence keys.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function git(cwd: string, args: string[], env?: Record<string, string>): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: env ? { ...process.env, ...env } : process.env,
  }).replace(/\r?\n$/, '');
}

export function tryGit(cwd: string, args: string[], env?: Record<string, string>): string | null {
  try {
    return git(cwd, args, env);
  } catch {
    return null;
  }
}

export function repoRoot(dir: string): string | null {
  const root = tryGit(dir, ['rev-parse', '--show-toplevel']);
  return root ? path.resolve(root) : null;
}

export function headCommit(dir: string): string {
  return tryGit(dir, ['rev-parse', 'HEAD']) ?? 'none';
}

/** The code under a directory: not the map's own state, and never installed dependencies or tool caches. */
export const CODE_ONLY = ['--', '.', ':(exclude).deck', ':(exclude,glob)**/node_modules/**'];

/** Uncommitted changes to the code under `dir`. The .deck folder is the map's own state and does not count. */
export function isDirty(dir: string): boolean {
  const out = tryGit(dir, ['status', '--porcelain', ...CODE_ONLY]);
  return out !== null && out.trim().length > 0;
}

/** Paths under `dir` that differ from HEAD, relative to `dir`. */
export function changedPaths(dir: string): string[] {
  const out = tryGit(dir, ['status', '--porcelain', '--no-renames', '-uall', ...CODE_ONLY]);
  if (!out) return [];
  const prefix = tryGit(dir, ['rev-parse', '--show-prefix']) ?? '';
  return out
    .split('\n')
    .map((line) => line.slice(3).replace(/^"|"$/g, ''))
    .filter(Boolean)
    .map((p) => (prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p));
}

/**
 * A hash of the code exactly as it is on disk under `dir`, committed or not.
 * A test run is current only while this matches the tree it ran against.
 */
export function workingTreeHash(dir: string): string {
  const root = repoRoot(dir);
  if (!root) return 'no-git';
  const scratch = mkdtempSync(path.join(tmpdir(), 'decker-index-'));
  const index = path.join(scratch, 'index');
  try {
    // An empty scratch index, so the tree holds exactly the code under `dir` and nothing else.
    const env = { GIT_INDEX_FILE: index };
    git(dir, ['add', '-A', ...CODE_ONLY], env);
    return createHash('sha1').update(git(dir, ['write-tree'], env)).digest('hex');
  } catch {
    return `unknown-${Date.now()}`;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Files git reports as renamed between a commit and the working tree (or another commit): old -> new, relative to `dir`. */
export function renames(dir: string, from: string, to?: string): Record<string, string> {
  const prefix = tryGit(dir, ['rev-parse', '--show-prefix']) ?? '';
  const out: Record<string, string> = {};
  const add = (text: string | null) => {
    for (const line of (text ?? '').split('\n')) {
      const m = line.match(/^R\d*\t(.+)\t(.+)$/);
      if (!m) continue;
      const strip = (p: string) => (prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p);
      out[strip(m[1]!)] = strip(m[2]!);
    }
  };
  if (from === 'none') return out;
  add(tryGit(dir, ['diff', '--name-status', '-M', from, ...(to ? [to] : []), '--', '.']));
  if (!to) {
    // Staged and unstaged renames against HEAD, including files moved without `git mv`.
    const scratch = mkdtempSync(path.join(tmpdir(), 'decker-index-'));
    try {
      const real = git(dir, ['rev-parse', '--git-path', 'index']);
      const realAbs = path.isAbsolute(real) ? real : path.resolve(dir, real);
      const index = path.join(scratch, 'index');
      if (existsSync(realAbs)) copyFileSync(realAbs, index);
      const env = { GIT_INDEX_FILE: index };
      git(dir, ['add', '-A', '--', '.'], env);
      add(tryGit(dir, ['diff', '--cached', '--name-status', '-M', from, '--', '.'], env));
    } catch {
      // no renames found
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  return out;
}

export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  patch: string;
}

/** The diff between two commits, limited to `dir`, one entry per file. */
export function diffFiles(dir: string, from: string, to: string): DiffFile[] {
  const prefix = tryGit(dir, ['rev-parse', '--show-prefix']) ?? '';
  const raw = tryGit(dir, ['diff', '--no-color', '-M', '--relative', from, to, '--', '.']) ?? '';
  const files: DiffFile[] = [];
  for (const chunk of raw.split(/^diff --git /m).slice(1)) {
    const header = chunk.slice(0, chunk.indexOf('\n'));
    const m = header.match(/ b\/(.+)$/);
    const body = chunk.slice(chunk.indexOf('\n') + 1);
    const hunk = body.indexOf('@@');
    const status = /^new file mode/m.test(body) ? 'added' : /^deleted file mode/m.test(body) ? 'deleted' : /^rename from/m.test(body) ? 'renamed' : 'modified';
    files.push({ path: m ? m[1]! : header, status, patch: hunk >= 0 ? body.slice(hunk).replace(/\n$/, '') : '' });
  }
  void prefix;
  return files;
}

export function showFile(dir: string, ref: string, file: string): string | null {
  const prefix = tryGit(dir, ['rev-parse', '--show-prefix']) ?? '';
  return tryGit(dir, ['show', `${ref}:${prefix}${file}`]);
}
