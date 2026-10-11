// The change loop (spec §6.1): Draft, Planning, Plan ready, Implementing, Checking,
// In review, then Accepted, revised or Rejected. The working branch is never touched
// until Accept, and Accept is a fast-forward.
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { type IdsFile, TypeScriptAdapter } from '@decker/adapter-typescript';
import type { AgentWorker, Sandbox, WorkPackage } from '@decker/agent-gateway';
import {
  buildIndex,
  type Candidate,
  type Change,
  type ChangeOp,
  type CheckResult,
  type DeckNotes,
  type DeckSnapshot,
  freshId,
  type Id,
  type Plan,
  type ReviewBundle,
  renderDeckText,
  type ServerEvent,
  type TestRun,
  type TestStatus,
  withNotes,
} from '@decker/deck-model';
import type { CheckSpec, DeckDir, DeckSettings } from './deckdir.ts';
import { CODE_ONLY, diffFiles, git, headCommit, isDirty, renames, tryGit, workingTreeHash } from './git.ts';
import { readSecrets, runChecks } from './harness.ts';
import { reconcile } from './reconcile.ts';
import {
  ContainerSandbox,
  type ContainerSpec,
  HostSandbox,
  type RunResult,
  type SandboxKind,
} from './sandbox.ts';

export interface DeckHost {
  /** The deck root: the directory decker was started on. */
  root: string;
  /** The git repository that contains it, or null when there is none. */
  gitRoot: string | null;
  dir: DeckDir;
  sandbox: SandboxKind;
  settings(): DeckSettings;
  snapshot(): DeckSnapshot;
  ids(): IdsFile;
  notes(): DeckNotes;
  emit(event: ServerEvent): void;
  /** Re-read the working tree after it changed underneath the server. */
  reload(): Promise<void>;
  recordRun(run: TestRun): void;
}

interface StoredCandidate {
  base: DeckSnapshot;
  snapshot: DeckSnapshot;
  ids: IdsFile;
  checks: CheckResult[];
  results: Record<Id, TestStatus>;
  failures: Record<Id, string>;
  treeHash: string;
  ranAt: string;
}

export class StateError extends Error {}

const now = () => new Date().toISOString();
const IDENTITY = ['-c', 'user.name=Double Decker', '-c', 'user.email=decker@localhost'];

function opTargets(op: ChangeOp): Id[] {
  switch (op.type) {
    case 'add_edge':
      return [op.from, op.to];
    case 'add_block':
      return [op.parentId];
    default:
      return [op.targetId];
  }
}

export class Coordinator {
  private host: DeckHost;
  private worker: AgentWorker | null;
  private changes = new Map<Id, Change>();
  private sandboxes = new Map<string, ContainerSandbox>();

  constructor(host: DeckHost, worker: AgentWorker | null) {
    this.host = host;
    this.worker = worker;
  }

  /** Load the change records. Anything that was mid-run when the server stopped is marked failed. */
  init(): void {
    for (const change of this.host.dir.changes()) {
      this.changes.set(change.id, change);
      if (change.state !== 'planning' && change.state !== 'implementing' && change.state !== 'checking')
        continue;
      const step = change.state;
      const last = change.candidates.at(-1);
      if (last && (last.status === 'implementing' || last.status === 'checking')) {
        last.status = 'failed';
        last.error = 'The server stopped during this run.';
        this.dropWorktree(last);
      }
      this.update(
        change,
        { state: 'failed', error: `The server stopped while ${step}. Nothing was merged. Try again.` },
        'interrupted',
      );
    }
    if (this.host.gitRoot) tryGit(this.host.gitRoot, ['worktree', 'prune']);
  }

  list(): Change[] {
    return [...this.changes.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(id: Id): Change {
    const change = this.changes.get(id);
    if (!change) throw new StateError('No such change.');
    return change;
  }

  private update(change: Change, patch: Partial<Change>, event?: string, detail?: string): Change {
    Object.assign(change, patch, { updatedAt: now(), rev: (change.rev ?? 0) + 1 });
    if (patch.state && patch.state !== 'failed') change.error = undefined;
    if (event) change.events.push({ at: now(), type: event, detail });
    this.changes.set(change.id, change);
    this.host.dir.writeChange(change);
    this.host.emit({ type: 'change', change });
    return change;
  }

  private progress(change: Change, text: string): void {
    for (const line of text.split('\n'))
      if (line.trim())
        this.host.emit({ type: 'progress', changeId: change.id, text: line.slice(0, 400), at: now() });
  }

  // ---- Drafts ----

  upsertDraft(id: Id, patch: { title?: string; operations?: ChangeOp[] }): Change {
    const existing = this.changes.get(id);
    if (existing && existing.state !== 'draft')
      throw new StateError('Only a draft can be edited. Revise the change instead.');
    const change: Change = existing ?? {
      id,
      title: 'Change',
      state: 'draft',
      operations: [],
      candidates: [],
      events: [{ at: now(), type: 'created' }],
      createdAt: now(),
      updatedAt: now(),
    };
    return this.update(change, {
      title: patch.title ?? change.title,
      operations: patch.operations ?? change.operations,
    });
  }

  discard(id: Id): void {
    const change = this.get(id);
    if (change.state !== 'draft' && change.state !== 'rejected' && change.state !== 'failed')
      throw new StateError('Reject the change before discarding it.');
    for (const c of change.candidates) this.dropWorktree(c);
    this.changes.delete(id);
    this.host.dir.removeChange(id);
  }

  // ---- Planning ----

  private workPackage(
    change: Change,
    worktree: string,
    candidate: number,
    baseCommit: string,
    revise?: string,
  ): WorkPackage {
    const index = buildIndex(withNotes(this.host.snapshot(), this.host.notes()));
    return {
      changeId: change.id,
      title: change.title,
      candidate,
      worktree,
      baseCommit,
      deckText: renderDeckText(index, {
        focus: change.operations.flatMap(opTargets),
        operations: change.operations,
      }),
      operations: change.operations,
      plan: change.plan,
      revise,
      allowedPaths: ['src/**', 'test/**', 'tests/**'],
      budget: { minutes: 20, turns: 80 },
    };
  }

  private requireLoop(): { gitRoot: string; worker: AgentWorker } {
    if (!this.host.gitRoot)
      throw new StateError('Changes need a git repository: candidates are built in worktrees.');
    if (!this.worker) throw new StateError('No agent worker is configured.');
    return { gitRoot: this.host.gitRoot, worker: this.worker };
  }

  submit(id: Id): Change {
    const change = this.get(id);
    const { worker } = this.requireLoop();
    if (change.state !== 'draft' && change.state !== 'failed')
      throw new StateError('This change was already submitted.');
    if (change.operations.length === 0) throw new StateError('There is nothing to submit yet.');
    if (isDirty(this.host.root))
      throw new StateError('Commit your own changes first: a candidate is built from the last commit.');
    this.update(change, { state: 'planning', plan: undefined }, 'submitted');
    void this.plan(change, worker);
    return change;
  }

  private async plan(change: Change, worker: AgentWorker): Promise<void> {
    try {
      let plan: Plan | undefined;
      for await (const ev of worker.plan(
        this.workPackage(change, this.host.root, 0, headCommit(this.host.root)),
      )) {
        if (ev.type === 'error') throw new Error(ev.text ?? 'Planning failed.');
        if (ev.type === 'plan') plan = ev.plan;
        else if (ev.text) this.progress(change, ev.text);
      }
      if (!plan) throw new Error('The planner returned no plan.');
      this.update(
        change,
        {
          plan: { ...plan, limits: plan.limits ?? [], approved: false },
          state: plan.questions.some((q) => !q.answer) ? 'needs_answer' : 'plan_ready',
        },
        'planned',
      );
    } catch (err) {
      this.update(
        change,
        { state: 'failed', error: err instanceof Error ? err.message : String(err) },
        'plan_failed',
      );
    }
  }

  patchPlan(
    id: Id,
    patch: {
      requirements?: Plan['requirements'];
      answers?: Record<Id, string>;
      interpretation?: string;
      waive?: { requirementId: Id; note: string };
    },
  ): Change {
    const change = this.get(id);
    if (!change.plan) throw new StateError('This change has no plan yet.');
    const plan: Plan = { ...change.plan };
    if (patch.waive) {
      if (!patch.waive.note.trim()) throw new StateError('A waiver needs a note.');
      plan.requirements = plan.requirements.map((r) =>
        r.id === patch.waive!.requirementId ? { ...r, waived: patch.waive!.note.trim() } : r,
      );
      return this.update(change, { plan }, 'waived', patch.waive.note.trim());
    }
    if (change.state !== 'plan_ready' && change.state !== 'needs_answer')
      throw new StateError('The plan is already approved.');
    if (patch.interpretation !== undefined) plan.interpretation = patch.interpretation;
    if (patch.requirements) plan.requirements = patch.requirements.filter((r) => r.text.trim());
    if (patch.answers) {
      plan.questions = plan.questions.map((q) => ({
        ...q,
        answer: patch.answers![q.id]?.trim() || q.answer,
      }));
      // Decisions the engineer made are limits recorded on the change and shown on the arrow.
      plan.limits = plan.questions.filter((q) => q.answer).map((q) => `${q.text} ${q.answer}`);
    }
    return this.update(change, {
      plan,
      state: plan.questions.some((q) => !q.answer) ? 'needs_answer' : 'plan_ready',
    });
  }

  // ---- Implementing and checking ----

  approve(id: Id): Change {
    const change = this.get(id);
    const { worker } = this.requireLoop();
    if (change.state !== 'plan_ready')
      throw new StateError(
        change.state === 'needs_answer' ? 'Answer the open questions first.' : 'There is no plan to approve.',
      );
    if (this.host.sandbox === 'none')
      throw new StateError(
        'No sandbox is available. Install Docker or Podman, or start decker with --sandbox=host to run on this machine without isolation.',
      );
    this.update(change, { plan: { ...change.plan!, approved: true }, state: 'implementing' }, 'approved');
    void this.candidate(change, worker);
    return change;
  }

  revise(id: Id, comment: string): Change {
    const change = this.get(id);
    const { worker } = this.requireLoop();
    if (change.state !== 'in_review') throw new StateError('Only a candidate in review can be revised.');
    const last = change.candidates.at(-1);
    if (last) last.status = 'superseded';
    this.update(change, { state: 'implementing' }, 'revise', comment);
    void this.candidate(change, worker, comment || 'Try again.');
    return change;
  }

  retry(id: Id): Change {
    const change = this.get(id);
    const { worker } = this.requireLoop();
    if (change.state !== 'failed') throw new StateError('Only a failed change can be tried again.');
    if (!change.plan?.approved) {
      this.update(change, { state: 'draft', error: undefined });
      return this.submit(id);
    }
    this.update(change, { state: 'implementing', error: undefined }, 'retry');
    void this.candidate(change, worker);
    return change;
  }

  private worktreePath(change: Change, n: number): string {
    return path.join(this.host.dir.cache, 'worktrees', `${change.id}-c${n}`);
  }

  private deckRootIn(worktree: string): string {
    return path.join(worktree, path.relative(this.host.gitRoot!, this.host.root));
  }

  private dropWorktree(candidate: Candidate): void {
    const gitRoot = this.host.gitRoot;
    if (!gitRoot || !candidate.worktree) return;
    void this.sandboxes.get(candidate.worktree)?.stop();
    this.sandboxes.delete(candidate.worktree);
    if (existsSync(candidate.worktree)) {
      if (tryGit(gitRoot, ['worktree', 'remove', '--force', candidate.worktree]) === null) {
        try {
          rmSync(candidate.worktree, { recursive: true, force: true });
        } catch {
          // A process from an interrupted run may still hold the folder. It is in the cache and is cleared next time.
        }
      }
    }
    tryGit(gitRoot, ['worktree', 'prune']);
  }

  private containerSpec(worktree: string): ContainerSpec {
    return {
      cli: this.host.sandbox as 'docker' | 'podman',
      image: this.host.settings().image,
      mount: worktree,
      workdir: this.deckRootIn(worktree),
    };
  }

  private async candidate(change: Change, worker: AgentWorker, comment?: string): Promise<void> {
    const gitRoot = this.host.gitRoot!;
    const previous = change.candidates.filter((c) => c.commit).at(-1);
    const n = change.candidates.length + 1;
    const base = previous?.baseCommit ?? headCommit(gitRoot);
    const candidate: Candidate = {
      n,
      branch: `deck/${change.id}/c${n}`,
      worktree: this.worktreePath(change, n),
      baseCommit: base,
      status: 'implementing',
      comment,
      checks: [],
    };
    change.candidates.push(candidate);
    this.update(change, {}, 'candidate', `candidate ${n}`);
    try {
      // 1. A worktree on its own branch. A revision builds on the candidate it revises.
      try {
        rmSync(candidate.worktree, { recursive: true, force: true });
      } catch {
        // handled by git below, which refuses a folder it cannot use
      }
      tryGit(gitRoot, ['worktree', 'prune']);
      tryGit(gitRoot, ['branch', '-D', candidate.branch]);
      git(gitRoot, ['worktree', 'add', '-b', candidate.branch, candidate.worktree, previous?.commit ?? base]);
      const root = this.deckRootIn(candidate.worktree);

      // 2. Prepare, then implement. Agent commands run only through the sandbox.
      let sandbox: Sandbox;
      if (this.host.sandbox === 'host') sandbox = new HostSandbox(root);
      else {
        this.progress(change, 'prepare: installing dependencies in a container (install scripts disabled)');
        const prepared = await ContainerSandbox.prepare(this.containerSpec(candidate.worktree));
        if (prepared.exitCode !== 0) throw new Error(`Prepare failed.\n${prepared.output.slice(-2000)}`);
        const container = new ContainerSandbox(this.containerSpec(candidate.worktree));
        this.sandboxes.set(candidate.worktree, container);
        sandbox = container;
      }
      let notes = '';
      for await (const ev of worker.implement(this.workPackage(change, root, n, base, comment), sandbox)) {
        if (ev.type === 'error') throw new Error(ev.text ?? 'The agent failed.');
        if (ev.type === 'done') notes = ev.text ?? '';
        else if (ev.text) this.progress(change, ev.text);
      }
      await this.sandboxes.get(candidate.worktree)?.stop();
      candidate.notes = notes;

      // 3. Whatever diff is in the worktree is the result. The .deck folder is not the agent's to edit.
      git(candidate.worktree, ['add', '-A', ...CODE_ONLY]);
      if (!git(candidate.worktree, ['diff', '--cached', '--name-only']).trim())
        throw new Error('The agent finished without changing any code.');
      git(candidate.worktree, [
        ...IDENTITY,
        'commit',
        '--quiet',
        '--no-verify',
        '-m',
        `deck: ${change.title} (candidate ${n})`,
      ]);
      candidate.commit = git(candidate.worktree, ['rev-parse', 'HEAD']);

      await this.check(change, candidate);
    } catch (err) {
      await this.sandboxes.get(candidate.worktree)?.stop();
      candidate.status = 'failed';
      candidate.error = err instanceof Error ? err.message : String(err);
      this.dropWorktree(candidate);
      this.update(change, { state: 'failed', error: candidate.error }, 'candidate_failed');
    }
  }

  /** Extract the candidate, run the checks in a clean sandbox, and open it for review. */
  private async check(change: Change, candidate: Candidate): Promise<void> {
    candidate.status = 'checking';
    this.update(change, { state: 'checking' }, 'checking');
    const root = this.deckRootIn(candidate.worktree);
    const settings = this.host.settings();
    const adapter = new TypeScriptAdapter(root, {
      tsconfig: settings.tsconfig,
      testPatterns: settings.testPatterns,
      exclude: settings.exclude,
      name: path.basename(this.host.root),
    });
    const extracted = adapter.extract({
      commit: candidate.commit!,
      dirty: false,
      ids: this.host.ids(),
      renames: renames(root, candidate.baseCommit, candidate.commit),
    });
    const run = await runChecks(
      root,
      settings.checks,
      extracted.snapshot.tests,
      (check, command) => this.exec(check, command, candidate.worktree),
      (text) => this.progress(change, text),
    );
    candidate.checks = run.checks.map((c) => ({ ...c, output: c.output.slice(-4000) }));
    const stored: StoredCandidate = {
      base:
        this.host.dir.readCache<StoredCandidate>(this.cacheName(change, candidate.n - 1))?.base ??
        this.host.snapshot(),
      snapshot: extracted.snapshot,
      ids: extracted.ids,
      checks: run.checks,
      results: run.results,
      failures: run.failures,
      treeHash: workingTreeHash(root),
      ranAt: now(),
    };
    this.host.dir.writeCache(this.cacheName(change, candidate.n), stored);
    candidate.status = 'in_review';
    this.update(change, { state: 'in_review' }, 'in_review', `candidate ${candidate.n}`);
  }

  private cacheName(change: Change, n: number): string {
    return path.join('candidates', `${change.id}-c${n}.json`);
  }

  /** Where a check runs: a fresh container with the network off, or the host when the engineer opted in. */
  private async exec(
    check: CheckSpec,
    command: string,
    worktree: string | null,
  ): Promise<RunResult | { skipped: string }> {
    const cwd = worktree ? this.deckRootIn(worktree) : this.host.root;
    const secrets = readSecrets(this.host.root, check);
    if (secrets === null) return { skipped: 'Its credentials are not configured on this machine.' };
    if (this.host.sandbox === 'none') return { skipped: 'No sandbox is available.' };
    if (this.host.sandbox === 'host') return new HostSandbox(cwd, secrets).run(command);
    if (check.network?.length) return { skipped: 'It needs the network allow-list, which is not built yet.' };
    return ContainerSandbox.check(
      {
        cli: this.host.sandbox,
        image: this.host.settings().image,
        mount: worktree ?? this.host.gitRoot ?? this.host.root,
        workdir: cwd,
      },
      command,
      secrets,
    );
  }

  /** Run the checks on the working tree, for the tests chips on the map. */
  async checkWorkingTree(): Promise<TestRun> {
    const snapshot = this.host.snapshot();
    const treeHash = workingTreeHash(this.host.root);
    const run = await runChecks(
      this.host.root,
      this.host.settings().checks,
      snapshot.tests,
      (check, command) => this.exec(check, command, null),
    );
    const result: TestRun = {
      commit: snapshot.sourceCommit,
      treeHash,
      ranAt: now(),
      results: run.results,
      checks: run.checks.map((c) => ({ ...c, output: c.output.slice(-4000) })),
    };
    this.host.recordRun(result);
    return result;
  }

  // ---- Review ----

  review(id: Id): ReviewBundle {
    const change = this.get(id);
    const candidate = change.candidates.at(-1);
    const stored = candidate
      ? this.host.dir.readCache<StoredCandidate>(this.cacheName(change, candidate.n))
      : null;
    if (!candidate || !stored || !candidate.commit)
      throw new StateError('This change has no candidate to review.');
    const r = reconcile({
      base: stored.base,
      candidate: stored.snapshot,
      operations: change.operations,
      plan: change.plan,
      checks: stored.checks,
      results: stored.results,
      failures: stored.failures,
      reverts: Boolean(change.reverts),
    });
    return {
      changeId: change.id,
      candidate: candidate.n,
      base: stored.base,
      snapshot: stored.snapshot,
      findings: r.findings,
      checks: stored.checks,
      testRun: {
        commit: candidate.commit,
        treeHash: stored.treeHash,
        ranAt: stored.ranAt,
        results: stored.results,
        checks: [],
      },
      testDelta: r.testDelta,
      diff: diffFiles(this.host.root, candidate.baseCommit, candidate.commit),
      changedIds: r.changedIds,
      canAccept: change.state === 'in_review' && r.blockers.length === 0,
      blockers: r.blockers,
    };
  }

  async accept(id: Id): Promise<Change> {
    const change = this.get(id);
    const gitRoot = this.requireLoop().gitRoot;
    if (change.state !== 'in_review') throw new StateError('Only a candidate in review can be accepted.');
    const candidate = change.candidates.at(-1)!;
    const review = this.review(id);
    if (!review.canAccept) throw new StateError(`Accept is blocked. ${review.blockers.join(' ')}`);
    if (isDirty(this.host.root))
      throw new StateError('Commit or stash your own changes first, so the candidate can be merged cleanly.');

    const head = headCommit(gitRoot);
    if (head !== candidate.baseCommit) {
      // The base moved: rebase the candidate, check it again, and send it back to review.
      try {
        git(candidate.worktree, [...IDENTITY, 'rebase', head]);
      } catch {
        tryGit(candidate.worktree, ['rebase', '--abort']);
        throw new StateError(
          'The base has moved and the candidate no longer applies cleanly. Revise it, or reject it.',
        );
      }
      candidate.baseCommit = head;
      candidate.commit = git(candidate.worktree, ['rev-parse', 'HEAD']);
      // The base snapshot for the next review is the map as it is now.
      this.host.dir.writeCache(this.cacheName(change, candidate.n - 1), { base: this.host.snapshot() });
      await this.check(change, candidate);
      throw new StateError(
        'The base had moved. The candidate was rebased and checked again: review it once more.',
      );
    }

    // Record what the engineer asked for, so it survives as authored intent on the map.
    const stored = this.host.dir.readCache<StoredCandidate>(this.cacheName(change, candidate.n))!;
    const notes = this.host.notes();
    const layout = this.host.dir.layout();
    const targets = new Map(
      review.findings.filter((f) => f.opId && f.kind === 'implemented').map((f) => [f.opId!, f.targetIds]),
    );
    const author = (owner: Id, texts: string[]) => {
      if (texts.length === 0) return;
      notes.bullets[owner] = [
        ...(notes.bullets[owner] ?? []),
        ...texts.map((text) => ({ id: freshId('bullet'), text, origin: 'authored' as const })),
      ];
    };
    for (const op of change.operations) {
      const real = targets.get(op.id)?.[0];
      if (op.type === 'add_behavior') author(op.targetId, [op.text]);
      else if (op.type === 'add_block' && real) {
        author(real, op.bullets);
        if (op.position && layout) layout.positions[real] = op.position;
      } else if (op.type === 'add_edge' && real) {
        author(real, [...op.bullets, ...(change.plan?.limits ?? []).map((l) => `Limit: ${l}`)]);
        notes.edges = { ...notes.edges, [real]: { kind: op.kind, label: op.label } };
      }
    }

    git(gitRoot, ['merge', '--ff-only', '--quiet', candidate.commit!]);
    candidate.status = 'accepted';
    this.host.dir.writeIds(stored.ids);
    this.host.dir.writeNotes(notes);
    if (layout) this.host.dir.writeLayout(layout);
    // Record the acceptance and commit it with the rest of .deck before anyone is told,
    // so "Accepted" always means the working branch is complete.
    Object.assign(change, {
      state: 'accepted',
      merged: { base: candidate.baseCommit, head: candidate.commit! },
      error: undefined,
      updatedAt: now(),
      rev: (change.rev ?? 0) + 1,
    });
    change.events.push({ at: now(), type: 'accepted', detail: `candidate ${candidate.n}` });
    this.host.dir.writeChange(change);
    git(this.host.root, ['add', '--', '.deck']);
    if (git(this.host.root, ['diff', '--cached', '--name-only']).trim())
      git(this.host.root, [
        ...IDENTITY,
        'commit',
        '--quiet',
        '--no-verify',
        '-m',
        `deck: accept ${change.title}`,
      ]);
    // The harness already ran the checks against exactly this code.
    this.host.recordRun({
      commit: headCommit(gitRoot),
      treeHash: workingTreeHash(this.host.root),
      ranAt: stored.ranAt,
      results: stored.results,
      checks: candidate.checks,
    });
    for (const c of change.candidates) this.dropWorktree(c);
    await this.host.reload();
    this.host.emit({ type: 'change', change });
    return change;
  }

  reject(id: Id): Change {
    const change = this.get(id);
    if (change.state === 'accepted')
      throw new StateError('An accepted change cannot be rejected. Revert it instead.');
    for (const c of change.candidates) {
      if (c.status !== 'accepted') c.status = c.status === 'failed' ? 'failed' : 'rejected';
      this.dropWorktree(c);
    }
    return this.update(change, { state: 'rejected' }, 'rejected');
  }

  /** Undo an accepted change through a revert candidate that goes through the same review. */
  revert(id: Id): Change {
    const original = this.get(id);
    const gitRoot = this.requireLoop().gitRoot;
    if (original.state !== 'accepted' || !original.merged)
      throw new StateError('Only an accepted change can be reverted.');
    if (this.host.sandbox === 'none') throw new StateError('No sandbox is available to check the revert.');
    const change: Change = {
      id: freshId('change'),
      title: `Revert: ${original.title}`,
      state: 'implementing',
      operations: [],
      candidates: [],
      events: [{ at: now(), type: 'created', detail: `reverts ${original.id}` }],
      createdAt: now(),
      updatedAt: now(),
      reverts: original.id,
    };
    const candidate: Candidate = {
      n: 1,
      branch: `deck/${change.id}/c1`,
      worktree: this.worktreePath(change, 1),
      baseCommit: headCommit(gitRoot),
      status: 'implementing',
      checks: [],
    };
    change.candidates.push(candidate);
    this.update(change, {}, 'candidate', 'revert');
    void (async () => {
      try {
        git(gitRoot, ['worktree', 'add', '-b', candidate.branch, candidate.worktree, candidate.baseCommit]);
        git(candidate.worktree, [
          ...IDENTITY,
          'revert',
          '--no-edit',
          `${original.merged!.base}..${original.merged!.head}`,
        ]);
        candidate.commit = git(candidate.worktree, ['rev-parse', 'HEAD']);
        await this.check(change, candidate);
      } catch (err) {
        tryGit(candidate.worktree, ['revert', '--abort']);
        candidate.status = 'failed';
        this.dropWorktree(candidate);
        this.update(
          change,
          {
            state: 'failed',
            error: `The revert did not apply cleanly. ${err instanceof Error ? err.message.split('\n')[0] : ''}`,
          },
          'revert_failed',
        );
      }
    })();
    return change;
  }
}
