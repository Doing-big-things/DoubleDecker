// The deck for one repository: extraction, the .deck folder, the file watcher, test
// evidence and optional summaries. Everything the browser sees comes through here.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  confirmRename,
  type IdsFile,
  type RenameSuggestion,
  TypeScriptAdapter,
} from '@decker/adapter-typescript';
import {
  type AgentWorker,
  ClaudeWorker,
  ScriptedWorker,
  summarizeBlock,
  summaryKey,
} from '@decker/agent-gateway';
import {
  Coordinator,
  changedPaths,
  DeckDir,
  type DeckHost,
  type DeckSettings,
  detectRuntime,
  headCommit,
  isDirty,
  renames,
  repoRoot,
  type SandboxKind,
  showFile,
  workingTreeHash,
} from '@decker/core';
import {
  type Bullet,
  type DeckBundle,
  type DeckLayout,
  type DeckNotes,
  type DeckSnapshot,
  hashId,
  type Id,
  layoutSchema,
  notesSchema,
  type ServerEvent,
  type TestRun,
} from '@decker/deck-model';
import { watch } from 'chokidar';

export interface ServiceOptions {
  sandbox?: SandboxKind | 'auto';
  worker?: 'claude' | 'scripted' | 'none' | 'auto';
  watch?: boolean;
}

interface CachedSummary {
  summary?: string;
  bullets: { text: string; startLine: number; endLine: number }[];
}

export class DeckService implements DeckHost {
  readonly root: string;
  readonly gitRoot: string | null;
  readonly dir: DeckDir;
  readonly sandbox: SandboxKind;
  readonly coordinator: Coordinator;
  readonly workerName: string;
  private adapter: TypeScriptAdapter;
  private current!: DeckSnapshot;
  private currentIds!: IdsFile;
  private suggestions: RenameSuggestion[] = [];
  private treeHash = '';
  private gitState = '';
  private listeners = new Set<(event: ServerEvent) => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending = new Set<string>();
  private watcher: ReturnType<typeof watch> | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private summaries: Record<string, CachedSummary> = {};
  private summarizing = false;
  private checking = false;
  lastExtractMs = 0;

  constructor(root: string, options: ServiceOptions = {}) {
    this.root = path.resolve(root);
    if (!existsSync(this.root) || !statSync(this.root).isDirectory())
      throw new Error(`${this.root} is not a directory.`);
    this.gitRoot = repoRoot(this.root);
    this.dir = new DeckDir(this.root);
    this.dir.ensure();
    const settings = this.settings();
    this.adapter = new TypeScriptAdapter(this.root, {
      tsconfig: settings.tsconfig,
      testPatterns: settings.testPatterns,
      exclude: settings.exclude,
    });
    this.sandbox =
      !options.sandbox || options.sandbox === 'auto' ? (detectRuntime() ?? 'none') : options.sandbox;

    let worker: AgentWorker | null = null;
    const wanted =
      options.worker && options.worker !== 'auto' ? options.worker : (settings.worker?.type ?? 'claude');
    if (wanted === 'scripted') {
      const scripted = new ScriptedWorker(path.resolve(this.root, settings.worker?.dir ?? 'demo'));
      worker = scripted.available ? scripted : null;
    } else if (wanted === 'claude') worker = new ClaudeWorker({ model: settings.worker?.model });
    this.workerName = worker?.name ?? 'none';
    this.coordinator = new Coordinator(this, this.gitRoot ? worker : null);
    this.summaries = this.dir.readCache<Record<string, CachedSummary>>('summaries.json') ?? {};
  }

  async init(options: ServiceOptions = {}): Promise<void> {
    this.extract();
    this.coordinator.init();
    if (options.watch !== false) this.startWatching();
    void this.summarize();
  }

  // ---- DeckHost ----

  settings(): DeckSettings {
    return this.dir.settings();
  }
  snapshot(): DeckSnapshot {
    return this.current;
  }
  ids(): IdsFile {
    return this.currentIds;
  }
  notes(): DeckNotes {
    return this.dir.notes();
  }
  emit(event: ServerEvent): void {
    for (const listener of this.listeners) listener(event);
  }
  async reload(): Promise<void> {
    this.adapter.refresh();
    this.extract();
    this.emit({ type: 'deck', bundle: this.bundle() });
  }
  recordRun(run: TestRun): void {
    this.dir.writeCache('testrun.json', run);
  }

  subscribe(listener: (event: ServerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---- Extraction ----

  private extract(): void {
    const commit = this.gitRoot ? headCommit(this.root) : 'none';
    const result = this.adapter.extract({
      commit,
      dirty: this.gitRoot ? isDirty(this.root) : false,
      ids: this.dir.ids(),
      renames: this.gitRoot ? renames(this.root, commit) : {},
    });
    this.current = this.withSummaries(result.snapshot);
    this.currentIds = result.ids;
    this.suggestions = result.suggestions;
    this.lastExtractMs = result.ms;
    this.dir.writeIds(result.ids);
    this.dir.writeCache('snapshot.json', result.snapshot);
    this.treeHash = this.gitRoot
      ? workingTreeHash(this.root)
      : result.snapshot.nodes.map((n) => n.source[0]?.hash ?? '').join('');
    this.gitState = this.readGitState();
  }

  private readGitState(): string {
    return this.gitRoot ? `${headCommit(this.root)}:${isDirty(this.root)}` : '';
  }

  bundle(): DeckBundle {
    const changed = new Set(this.gitRoot ? changedPaths(this.root) : []);
    return {
      name: path.basename(this.root),
      snapshot: this.current,
      layout: this.dir.layout(),
      notes: this.dir.notes(),
      testRun: this.dir.readCache<TestRun>('testrun.json'),
      changes: this.coordinator.list(),
      capabilities: {
        server: true,
        editor: true,
        sandbox: this.sandbox,
        worker: this.workerName,
        summarizer: Boolean(this.settings().summarizer),
      },
      changedSinceBaseline: this.current.nodes
        .filter((n) => n.kind === 'block' && n.source.some((s) => changed.has(s.path)))
        .map((n) => n.id),
      treeHash: this.treeHash,
      renames: this.suggestions.map((s) => ({ id: s.id, from: s.from, to: s.to })),
    };
  }

  get renameSuggestions(): RenameSuggestion[] {
    return this.suggestions;
  }

  /** The engineer confirmed that a new name is the old entity: it keeps its id, layout and notes. */
  confirm(id: Id): void {
    const s = this.suggestions.find((x) => x.id === id);
    if (!s) throw new Error('No such suggestion.');
    this.dir.writeIds(confirmRename(this.dir.ids(), s));
    this.extract();
    this.emit({ type: 'deck', bundle: this.bundle() });
  }

  private startWatching(): void {
    const ignored = (file: string) =>
      /(^|[\\/])(node_modules|\.git|\.deck|dist|build|coverage)([\\/]|$)/.test(
        path.relative(this.root, file),
      );
    this.watcher = watch(this.root, {
      ignored,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 60, pollInterval: 20 },
    });
    const onFile = (file: string) => {
      if (!/\.[cm]?[jt]sx?$|tsconfig.*\.json$|package\.json$/.test(file)) return;
      this.pending.add(file);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), 120);
    };
    this.watcher.on('add', onFile).on('change', onFile).on('unlink', onFile);
    // Commits, checkouts and stashes change what the map is a map of.
    this.poll = setInterval(() => {
      if (this.pending.size === 0 && this.readGitState() !== this.gitState) void this.reload();
    }, 2000);
  }

  private flush(): void {
    const files = [...this.pending];
    this.pending.clear();
    try {
      if (files.some((f) => /tsconfig.*\.json$|package\.json$/.test(f))) this.adapter.refresh();
      else this.adapter.refresh(files);
      this.extract();
      this.emit({ type: 'deck', bundle: this.bundle() });
      void this.summarize();
    } catch (err) {
      console.error('decker: could not rebuild the map:', err instanceof Error ? err.message : err);
    }
  }

  async close(): Promise<void> {
    clearTimeout(this.timer);
    if (this.poll) clearInterval(this.poll);
    await this.watcher?.close();
  }

  // ---- .deck files ----

  saveLayout(body: unknown): DeckLayout {
    const layout = layoutSchema.parse(body);
    this.dir.writeLayout(layout);
    return layout;
  }

  saveNotes(body: unknown): DeckNotes {
    const notes = notesSchema.parse(body);
    this.dir.writeNotes(notes);
    return notes;
  }

  // ---- Source and editor ----

  private resolve(file: string): string {
    const abs = path.resolve(this.root, file);
    const rel = path.relative(this.root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('That path is outside the repository.');
    return abs;
  }

  source(file: string, ref?: string): string | null {
    const abs = this.resolve(file);
    if (ref)
      return /^[0-9a-f]{7,40}$/.test(ref) && this.gitRoot
        ? showFile(this.root, ref, file.replace(/\\/g, '/'))
        : null;
    return existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs, 'utf8') : null;
  }

  openInEditor(file: string, line: number): void {
    const abs = this.resolve(file);
    if (!existsSync(abs)) throw new Error('That file no longer exists.');
    if (/["&|<>^%\n\r]/.test(abs)) throw new Error('That path cannot be passed to an editor safely.');
    const safeLine = Number.isInteger(line) && line > 0 ? line : 1;
    const parts = this.settings().editor.split(/\s+/).filter(Boolean);
    const args = parts
      .slice(1)
      .map((part) => part.replaceAll('{path}', abs).replaceAll('{line}', String(safeLine)));
    const windows = process.platform === 'win32';
    const child = spawn(parts[0]!, windows ? args.map((a) => (a.includes(' ') ? `"${a}"` : a)) : args, {
      cwd: this.root,
      shell: windows,
      detached: !windows,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', () => {});
    child.unref();
  }

  // ---- Evidence ----

  get checksRunning(): boolean {
    return this.checking;
  }

  async runChecks(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    this.emit({ type: 'checks', running: true });
    try {
      await this.coordinator.checkWorkingTree();
    } finally {
      this.checking = false;
      this.emit({ type: 'checks', running: false });
      this.emit({ type: 'deck', bundle: this.bundle() });
    }
  }

  // ---- Summaries: an optional second pass that never delays the first paint ----

  private withSummaries(snapshot: DeckSnapshot): DeckSnapshot {
    const config = this.settings().summarizer;
    if (!config) return snapshot;
    return {
      ...snapshot,
      nodes: snapshot.nodes.map((n) => {
        if (n.kind !== 'block' || !n.source[0]) return n;
        const cached = this.summaries[summaryKey(n.source[0].hash, config)];
        return cached ? { ...n, ...this.summaryPatch(n.id, n.source[0].path, n.summary, cached) } : n;
      }),
    };
  }

  private summaryPatch(
    id: Id,
    file: string,
    existing: Bullet | undefined,
    s: CachedSummary,
  ): { summary?: Bullet; bullets: Bullet[] } {
    return {
      summary:
        existing ??
        (s.summary
          ? { id: hashId('bullet', `${id}:ai-summary`), text: s.summary, origin: 'summarized' }
          : undefined),
      bullets: s.bullets.map((b, i) => ({
        id: hashId('bullet', `${id}:ai:${i}:${b.text}`),
        text: b.text,
        origin: 'summarized' as const,
        derivedFrom: { path: file, startLine: b.startLine, endLine: b.endLine, hash: '' },
      })),
    };
  }

  private async summarize(): Promise<void> {
    const config = this.settings().summarizer;
    if (!config || this.summarizing) return;
    this.summarizing = true;
    try {
      const todo = this.current.nodes.filter(
        (n) => n.kind === 'block' && n.source[0] && !this.summaries[summaryKey(n.source[0].hash, config)],
      );
      let next = 0;
      const worker = async () => {
        while (next < todo.length) {
          const block = todo[next++]!;
          const ref = block.source[0]!;
          const text = this.source(ref.path);
          if (text === null) continue;
          try {
            const result = await summarizeBlock(
              config,
              block.name,
              ref.path,
              text,
              AbortSignal.timeout(60_000),
            );
            this.summaries[summaryKey(ref.hash, config)] = result;
            const patch = this.summaryPatch(
              block.id,
              ref.path,
              block.summary?.origin === 'summarized' ? undefined : block.summary,
              result,
            );
            this.current = {
              ...this.current,
              nodes: this.current.nodes.map((n) => (n.id === block.id ? { ...n, ...patch } : n)),
            };
            this.emit({ type: 'summary', nodeId: block.id, summary: patch.summary, bullets: patch.bullets });
          } catch {
            // No summary for this block. The map works without it.
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      if (todo.length) this.dir.writeCache('summaries.json', this.summaries);
    } finally {
      this.summarizing = false;
    }
  }
}
