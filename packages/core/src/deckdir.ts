// The .deck folder (spec §4.3): human-readable, diffable, committed with the code.
// Only cache/ is ignored. Writes are atomic: write a temporary file, then rename.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { emptyIds, type IdsFile } from '@decker/adapter-typescript';
import type { SummarizerConfig } from '@decker/agent-gateway';
import type { Change, DeckLayout, DeckNotes, Id } from '@decker/deck-model';

export interface CheckSpec {
  name: string;
  command: string;
  /** How results are read. 'vitest' attaches pass and fail to the tests on the map. */
  kind?: 'vitest' | 'command';
  /** Hosts this check may reach. Empty or absent means no network (spec §6.3, §9.3). */
  network?: string[];
  /** Names of environment variables the harness passes in, read from a git-ignored env file. */
  secrets?: string[];
  /** File the secrets are read from, relative to the deck root. */
  envFile?: string;
}

export interface DeckSettings {
  adapter: 'typescript';
  tsconfig?: string;
  testPatterns?: string[];
  exclude?: string[];
  /** Editor command template. {path} and {line} are filled in. */
  editor: string;
  checks: CheckSpec[];
  /** Container image for the sandbox. */
  image: string;
  worker?: {
    type: 'claude' | 'scripted' | 'none';
    dir?: string;
    model?: string;
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  };
  summarizer?: SummarizerConfig;
  /** Packages allowed to run install scripts during Prepare. */
  installScripts?: string[];
}

export class DeckDir {
  readonly root: string;
  readonly dir: string;

  constructor(root: string) {
    this.root = root;
    this.dir = path.join(root, '.deck');
  }

  get cache(): string {
    return path.join(this.dir, 'cache');
  }

  ensure(): void {
    mkdirSync(path.join(this.dir, 'changes'), { recursive: true });
    mkdirSync(this.cache, { recursive: true });
    const ignore = path.join(this.dir, '.gitignore');
    if (!existsSync(ignore)) writeFileSync(ignore, 'cache/\n');
  }

  private read<T>(file: string, fallback: T): T {
    try {
      return JSON.parse(readFileSync(path.join(this.dir, file), 'utf8')) as T;
    } catch {
      return fallback;
    }
  }

  private write(file: string, value: unknown): void {
    const target = path.join(this.dir, file);
    mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(tmp, target);
  }

  settings(): DeckSettings {
    const stored = this.read<Partial<DeckSettings>>('deck.json', {});
    return {
      adapter: 'typescript',
      editor: 'code --goto {path}:{line}',
      image: 'node:24-slim',
      ...stored,
      checks: stored.checks ?? this.defaultChecks(),
    };
  }

  /** With no deck.json, infer the checks from what the project already uses. */
  private defaultChecks(): CheckSpec[] {
    try {
      const pkg = JSON.parse(readFileSync(path.join(this.root, 'package.json'), 'utf8')) as {
        devDependencies?: Record<string, string>;
        dependencies?: Record<string, string>;
      };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const checks: CheckSpec[] = [];
      if (deps.typescript) checks.push({ name: 'typecheck', command: 'npx tsc --noEmit', kind: 'command' });
      if (deps.vitest) checks.push({ name: 'tests', command: 'npx vitest run', kind: 'vitest' });
      return checks;
    } catch {
      return [];
    }
  }

  ids(): IdsFile {
    return { ...emptyIds(), ...this.read<Partial<IdsFile>>('ids.json', {}) };
  }
  writeIds(ids: IdsFile): void {
    if (JSON.stringify(this.ids()) !== JSON.stringify(ids)) this.write('ids.json', ids);
  }

  layout(): DeckLayout | null {
    return this.read<DeckLayout | null>('layout.json', null);
  }
  writeLayout(layout: DeckLayout): void {
    this.write('layout.json', {
      version: 1,
      positions: sortKeys(layout.positions),
      pinned: [...layout.pinned].sort(),
    });
  }

  notes(): DeckNotes {
    return { version: 1, bullets: {}, dismissed: [], ...this.read<Partial<DeckNotes>>('notes.json', {}) };
  }
  writeNotes(notes: DeckNotes): void {
    this.write('notes.json', notes);
  }

  changes(): Change[] {
    const dir = path.join(this.dir, 'changes');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => this.read<Change | null>(path.join('changes', f), null))
      .filter((c): c is Change => c !== null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  writeChange(change: Change): void {
    this.write(path.join('changes', `${change.id}.json`), change);
  }
  removeChange(id: Id): void {
    rmSync(path.join(this.dir, 'changes', `${id}.json`), { force: true });
  }

  readCache<T>(file: string): T | null {
    return this.read<T | null>(path.join('cache', file), null);
  }
  writeCache(file: string, value: unknown): void {
    this.write(path.join('cache', file), value);
  }
}

function sortKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}
