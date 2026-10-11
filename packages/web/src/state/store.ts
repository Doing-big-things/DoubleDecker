import {
  type Bullet,
  buildIndex,
  type Change,
  type ChangeOp,
  type DeckBundle,
  type DeckIndex,
  type DeckSnapshot,
  describeOp,
  type FindingKind,
  freshId,
  type Id,
  type Point,
  pathTo,
  type ReviewBundle,
  type ServerEvent,
  type TestRun,
  withNotes,
} from '@decker/deck-model';
import { create } from 'zustand';
import { connect, type DeckSource, type Transition } from '../data/source';
import { camera, type Level, levelOf } from '../map/camera';
import { autoLayout, countMissing, type Positions, placeMissing } from '../model/layout';
import { collapsedHeight } from '../model/measure';
import { applyOps, type Marks } from '../model/pending';

export type PanelTab = 'overview' | 'tests' | 'source' | 'diff';

export interface Peek {
  path: string;
  startLine: number;
  endLine: number;
  title: string;
}

export type Popover =
  | { kind: 'edge'; from: Id; to: Id; x: number; y: number }
  | { kind: 'block'; parentId: Id; x: number; y: number; position?: Point }
  | { kind: 'rename'; targetId: Id; x: number; y: number }
  | null;

type UndoEntry =
  | { kind: 'ops'; before: ChangeOp[]; after: ChangeOp[] }
  | { kind: 'layout'; before: Positions; after: Positions; pinnedBefore: Id[]; pinnedAfter: Id[] };

export interface Toast {
  id: number;
  text: string;
  error?: boolean;
}

const OPEN_STATES = new Set<Change['state']>([
  'draft',
  'planning',
  'needs_answer',
  'plan_ready',
  'implementing',
  'checking',
  'in_review',
  'failed',
]);
export const isOpen = (c: Change) => OPEN_STATES.has(c.state);
export const isBusy = (c: Change) =>
  c.state === 'planning' || c.state === 'implementing' || c.state === 'checking';

const FINDING_RANK: Record<FindingKind, number> = {
  contradicted: 0,
  unrequested: 1,
  missing: 2,
  untested: 3,
  implemented: 4,
  supported: 5,
};

export interface DeckState {
  source: DeckSource | null;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  bundle: DeckBundle | null;
  index: DeckIndex | null;
  marks: Marks;
  findings: Map<Id, FindingKind>;
  changedIds: Set<Id> | null;
  positions: Positions;
  pinned: Id[];
  laying: boolean;
  layoutEpoch: number;

  theme: 'dark' | 'light';
  band: number;
  selectedId: Id | null;
  focusOpId: Id | null;
  lastFocus: Id | null;
  hoverId: Id | null;
  lit: Set<Id> | null;
  expanded: Set<Id>;
  internals: Set<Id>;
  testsToggled: Set<Id>;
  allTests: boolean;
  panelOpen: boolean;
  panelTab: PanelTab;
  panelWidth: number;
  peek: Peek | null;
  outlineOpen: boolean;
  paletteOpen: boolean;
  helpOpen: boolean;
  trayOpen: boolean;
  popover: Popover;
  editing: string | null;

  changes: Change[];
  activeChangeId: Id | null;
  review: ReviewBundle | null;
  showBefore: boolean;
  progress: Record<Id, string[]>;
  checksRunning: boolean;
  toasts: Toast[];
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];

  init(): Promise<void>;
  setBand(band: number): void;
  setTheme(theme: 'dark' | 'light'): void;
  select(id: Id | null, opts?: { fly?: boolean; op?: Id | null; keepTab?: boolean; silent?: boolean }): void;
  hover(id: Id | null): void;
  toggleExpand(id?: Id): void;
  toggleInternals(id: Id): void;
  toggleTests(id?: Id): void;
  toggleAllTests(): void;
  openPeek(peek: Peek): void;
  set(patch: Partial<DeckState>): void;
  escape(): void;
  back(): void;
  forward(): void;
  tidy(): Promise<void>;
  moveNode(id: Id, position: Point): void;
  toast(text: string, error?: boolean): void;

  addOp(op: ChangeOp): void;
  removeOp(opId: Id): void;
  setDraftTitle(title: string): void;
  requestRemove(targetId: Id, targetType: 'node' | 'edge' | 'bullet', label: string, ownerId?: Id): void;
  requestRename(targetId: Id, name: string): void;
  setBullet(ownerId: Id, bullet: Bullet, text: string): void;
  addBullet(targetId: Id, text: string): void;
  pinBullet(ownerId: Id, bullet: Bullet): void;
  dismissBullet(bulletId: Id): void;
  undo(): void;
  redo(): void;

  transition(id: Id, action: Transition, body?: unknown): Promise<void>;
  patchPlan(id: Id, patch: unknown): Promise<void>;
  discardChange(id: Id): Promise<void>;
  enterReview(id: Id): Promise<void>;
  exitReview(): void;
  setShowBefore(on: boolean): void;
  runChecks(): Promise<void>;
}

let started = false;
let hoverTimer: ReturnType<typeof setTimeout> | undefined;
let toastId = 0;
let summaryTimer: ReturnType<typeof setTimeout> | undefined;

const readLocal = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};
const writeLocal = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
};

function litFor(index: DeckIndex, id: Id): Set<Id> | null {
  const link = index.linkById.get(id) ?? index.areaLinks.find((l) => l.id === id);
  if (link) return new Set([link.id, link.from, link.to]);
  if (id.startsWith('ext:')) {
    const [, areaId, extId] = id.split(':');
    const out = new Set<Id>([id]);
    for (const kid of index.children.get(areaId!) ?? []) {
      if (index.externalsOf.get(kid.id)?.some((e) => e.id === extId)) out.add(kid.id);
    }
    return out;
  }
  const node = index.byId.get(id);
  if (!node) return null;
  if (node.kind === 'block') {
    const out = new Set<Id>([id]);
    for (const l of index.linksOut.get(id) ?? []) out.add(l.id).add(l.to);
    for (const l of index.linksIn.get(id) ?? []) out.add(l.id).add(l.from);
    return out;
  }
  if (node.kind === 'area') {
    const links = index.areaLinks.filter((l) => l.from === id || l.to === id);
    if (links.length === 0) return null;
    const out = new Set<Id>([id]);
    for (const l of links) out.add(l.id).add(l.from).add(l.to);
    return out;
  }
  return null;
}

function hashFor(index: DeckIndex | null, id: Id | null): string {
  if (!id || !index) return '#/';
  const node = index.byId.get(id);
  if (node) return `#/${node.kind}/${id}`;
  return `#/arrow/${encodeURIComponent(id)}`;
}

export function idFromHash(hash: string): Id | null {
  const m = hash.match(/^#\/(?:block|area|arrow|operation)\/(.+)$/);
  return m ? decodeURIComponent(m[1]!) : null;
}

export const useDeck = create<DeckState>()((set, get) => {
  const persistLayout = () => {
    const s = get();
    if (!s.source || !s.bundle || s.review) return;
    const real = new Set(s.bundle.snapshot.nodes.map((n) => n.id));
    const positions: Positions = {};
    for (const [id, p] of Object.entries(s.positions)) if (real.has(id)) positions[id] = p;
    s.source.saveLayout({ version: 1, positions, pinned: s.pinned.filter((id) => real.has(id)) });
  };

  const ensureLayout = () => {
    const s = get();
    const index = s.index;
    if (!index) return;
    const rest = (id: Id) => collapsedHeight(index, id);
    const { missing, total } = countMissing(index, s.positions);
    if (missing === 0 || total === 0) return;
    const hints: Positions = {};
    for (const c of s.changes) {
      for (const op of c.operations) {
        if (op.type !== 'add_block' || !op.position) continue;
        hints[op.id] = op.position;
        const finding = s.review?.findings.find((f) => f.opId === op.id && f.kind === 'implemented');
        if (finding?.targetIds[0]) hints[finding.targetIds[0]] = op.position;
      }
    }
    if (missing === total || missing / total > 0.4) {
      if (s.laying) return;
      set({ laying: true });
      autoLayout(index, rest)
        .then((positions) => {
          set((st) => ({ positions, pinned: [], laying: false, layoutEpoch: st.layoutEpoch + 1 }));
          persistLayout();
        })
        .catch((err: unknown) => {
          set({ laying: false });
          get().toast(`Layout failed: ${String(err)}`, true);
        });
      return;
    }
    set({ positions: placeMissing(index, s.positions, rest, hints) });
    persistLayout();
  };

  const rebuild = () => {
    const s = get();
    if (!s.bundle) return;
    let base: DeckSnapshot = s.bundle.snapshot;
    let ops: ChangeOp[] = [];
    const findings = new Map<Id, FindingKind>();
    let changedIds: Set<Id> | null = null;
    if (s.review) {
      if (s.showBefore) base = s.review.base;
      else {
        base = s.review.snapshot;
        changedIds = new Set(s.review.changedIds);
        const change = s.changes.find((c) => c.id === s.review!.changeId);
        const missing = new Set(
          s.review.findings.filter((f) => f.kind === 'missing' && f.opId).map((f) => f.opId!),
        );
        ops = (change?.operations ?? []).filter((o) => missing.has(o.id));
        const put = (id: Id, kind: FindingKind) => {
          const cur = findings.get(id);
          if (!cur || FINDING_RANK[kind] < FINDING_RANK[cur]) findings.set(id, kind);
          changedIds!.add(id);
        };
        // A finding about an operation also marks the block that owns it, so it is visible on a closed card.
        const nodes = new Map(s.review.snapshot.nodes.map((n) => [n.id, n]));
        for (const f of s.review.findings) {
          for (const id of f.targetIds) {
            put(id, f.kind);
            const node = nodes.get(id);
            if (
              node?.kind === 'operation' &&
              node.parentId &&
              f.kind !== 'supported' &&
              f.kind !== 'untested'
            )
              put(node.parentId, f.kind);
            else if (node?.kind === 'operation' && node.parentId) changedIds!.add(node.parentId);
          }
          if (f.kind === 'missing' && f.opId) put(f.opId, 'missing');
        }
      }
    } else {
      ops = s.changes.filter(isOpen).flatMap((c) => c.operations);
    }
    const applied = applyOps(withNotes(base, s.bundle.notes), ops);
    const index = buildIndex(applied.snapshot);
    const exists = (id: Id | null) =>
      id !== null &&
      (index.byId.has(id) || index.linkById.has(id) || index.areaLinks.some((l) => l.id === id));
    set({
      index,
      marks: applied.marks,
      findings,
      changedIds,
      selectedId: exists(s.selectedId) ? s.selectedId : null,
      focusOpId: s.focusOpId && index.byId.has(s.focusOpId) ? s.focusOpId : null,
    });
    ensureLayout();
  };

  const applyBundle = (bundle: DeckBundle, first: boolean) => {
    const prev = get();
    set({
      bundle,
      changes: bundle.changes,
      status: 'ready',
      error: null,
      positions: first
        ? (bundle.layout?.positions ?? {})
        : { ...(bundle.layout?.positions ?? {}), ...prev.positions },
      pinned: first ? (bundle.layout?.pinned ?? []) : prev.pinned,
    });
    rebuild();
  };

  const upsertChange = (change: Change) => {
    // Replies and pushed events race. Never let an older copy replace a newer one.
    const have = get().changes.find((c) => c.id === change.id);
    if (have?.rev !== undefined && change.rev !== undefined && change.rev < have.rev) return;
    set((s) => ({
      changes: s.changes.some((c) => c.id === change.id)
        ? s.changes.map((c) => (c.id === change.id ? change : c))
        : [...s.changes, change],
    }));
  };

  const onEvent = (event: ServerEvent) => {
    switch (event.type) {
      case 'deck':
        applyBundle(event.bundle, false);
        break;
      case 'change': {
        const before = get().changes.find((c) => c.id === event.change.id);
        upsertChange(event.change);
        if (before?.state !== event.change.state) {
          if (event.change.state === 'in_review') get().toast('A candidate is ready for review');
          if (event.change.state === 'plan_ready') get().toast('The plan is ready');
          if (event.change.state === 'failed') get().toast(event.change.error ?? 'The change failed', true);
        }
        if (get().review?.changeId === event.change.id && event.change.state !== 'in_review')
          set({ review: null, showBefore: false });
        rebuild();
        break;
      }
      case 'progress':
        set((s) => ({
          progress: {
            ...s.progress,
            [event.changeId]: [...(s.progress[event.changeId] ?? []), event.text].slice(-200),
          },
        }));
        break;
      case 'summary': {
        const s = get();
        if (!s.bundle) break;
        const nodes = s.bundle.snapshot.nodes.map((n) =>
          n.id === event.nodeId
            ? {
                ...n,
                summary: n.summary ?? event.summary,
                bullets: [...n.bullets.filter((b) => b.origin !== 'summarized'), ...event.bullets],
              }
            : n,
        );
        set({ bundle: { ...s.bundle, snapshot: { ...s.bundle.snapshot, nodes } } });
        clearTimeout(summaryTimer);
        summaryTimer = setTimeout(rebuild, 150);
        break;
      }
      case 'checks':
        set({ checksRunning: event.running });
        break;
    }
  };

  const draft = () => get().changes.find((c) => c.state === 'draft');

  const writeDraft = (after: ChangeOp[], record: boolean) => {
    const s = get();
    const index = s.index;
    const existing = draft();
    const before = existing?.operations ?? [];
    const now = new Date().toISOString();
    if (after.length === 0) {
      if (existing) {
        set({ changes: s.changes.filter((c) => c.id !== existing.id) });
        void s.source?.discardChange(existing.id).catch(() => {});
      }
    } else {
      const auto = index
        ? describeOp(
            buildIndex(applyOps(withNotes(s.bundle!.snapshot, s.bundle!.notes), after).snapshot),
            after[0]!,
            after,
          )
        : 'Change';
      const next: Change = existing
        ? {
            ...existing,
            operations: after,
            updatedAt: now,
            title: existing.title && existing.title !== autoTitleOf(existing) ? existing.title : auto,
          }
        : {
            id: freshId('change'),
            title: auto,
            state: 'draft',
            operations: after,
            candidates: [],
            events: [{ at: now, type: 'created' }],
            createdAt: now,
            updatedAt: now,
          };
      autoTitles.set(next.id, auto);
      upsertChange(next);
      void s.source?.saveChange(next).catch((e: unknown) => get().toast(String(e), true));
    }
    if (record)
      set((st) => ({
        undoStack: [...st.undoStack, { kind: 'ops' as const, before, after }].slice(-100),
        redoStack: [],
      }));
    rebuild();
  };
  const autoTitles = new Map<Id, string>();
  const autoTitleOf = (c: Change) => autoTitles.get(c.id) ?? c.title;

  const mutate = (fn: (ops: ChangeOp[]) => ChangeOp[]) => {
    if (get().review) {
      get().toast('Finish the review before editing the deck');
      return;
    }
    writeDraft(fn(draft()?.operations ?? []), true);
  };

  return {
    source: null,
    status: 'loading',
    error: null,
    bundle: null,
    index: null,
    marks: new Map(),
    findings: new Map(),
    changedIds: null,
    positions: {},
    pinned: [],
    laying: false,
    layoutEpoch: 0,

    theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
    band: 12,
    selectedId: null,
    focusOpId: null,
    lastFocus: null,
    hoverId: null,
    lit: null,
    expanded: new Set(),
    internals: new Set(),
    testsToggled: new Set(),
    allTests: false,
    panelOpen: false,
    panelTab: 'overview',
    panelWidth: readLocal('dd:panelWidth', 380),
    peek: null,
    outlineOpen: false,
    paletteOpen: false,
    helpOpen: false,
    trayOpen: false,
    popover: null,
    editing: null,

    changes: [],
    activeChangeId: null,
    review: null,
    showBefore: false,
    progress: {},
    checksRunning: false,
    toasts: [],
    undoStack: [],
    redoStack: [],

    async init() {
      if (started) return;
      started = true;
      try {
        const source = await connect();
        set({ source });
        const bundle = await source.load();
        applyBundle(bundle, true);
        source.subscribe(onEvent);
        const fromHash = idFromHash(location.hash);
        if (fromHash) setTimeout(() => get().select(fromHash, { fly: true, silent: true }), 600);
      } catch (err) {
        set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    },

    setBand(band) {
      if (band !== get().band) set({ band });
    },

    setTheme(theme) {
      document.documentElement.dataset.theme = theme;
      writeLocal('dd:theme', theme);
      try {
        localStorage.setItem('dd:theme', theme);
      } catch {
        // ignore
      }
      set({ theme });
    },

    select(id, opts = {}) {
      const s = get();
      const index = s.index;
      if (id && index) {
        const node = index.byId.get(id);
        if (node && (node.kind === 'operation' || node.kind === 'data')) {
          const block = index.blockOf.get(id);
          if (block) return get().select(block, { ...opts, op: id });
        }
      }
      const changed = id !== s.selectedId;
      if (opts.fly && id) {
        camera.record(s.selectedId);
        camera.flyTo(id);
      }
      set({
        selectedId: id,
        focusOpId: opts.op ?? null,
        lastFocus: id ?? s.lastFocus,
        panelOpen: id ? true : s.review ? s.panelOpen : false,
        panelTab: changed && !opts.keepTab ? 'overview' : s.panelTab,
        peek: changed ? null : s.peek,
        editing: null,
      });
      if (changed && !opts.silent) {
        const hash = hashFor(index, id);
        if (location.hash !== hash)
          history.pushState(null, '', hash === '#/' ? location.pathname + location.search : hash);
      }
    },

    hover(id) {
      clearTimeout(hoverTimer);
      if (id === null) {
        if (get().hoverId !== null) set({ hoverId: null, lit: null });
        return;
      }
      if (id === get().hoverId) return;
      hoverTimer = setTimeout(() => {
        const index = get().index;
        if (index) set({ hoverId: id, lit: litFor(index, id) });
      }, 150);
    },

    toggleExpand(id) {
      const target = id ?? get().selectedId;
      if (!target || get().index?.byId.get(target)?.kind !== 'block') return;
      const expanded = new Set(get().expanded);
      if (expanded.has(target)) expanded.delete(target);
      else expanded.add(target);
      set({ expanded });
    },

    toggleInternals(id) {
      const internals = new Set(get().internals);
      if (internals.has(id)) internals.delete(id);
      else internals.add(id);
      set({ internals });
    },

    toggleTests(id) {
      const target = id ?? get().selectedId;
      if (!target || get().index?.byId.get(target)?.kind !== 'block') return;
      const testsToggled = new Set(get().testsToggled);
      if (testsToggled.has(target)) testsToggled.delete(target);
      else testsToggled.add(target);
      set({ testsToggled });
    },

    toggleAllTests() {
      set((s) => ({ allTests: !s.allTests, testsToggled: new Set() }));
    },

    openPeek(peek) {
      set({ peek, panelOpen: true, panelTab: 'source' });
    },

    set(patch) {
      if (patch.panelWidth) writeLocal('dd:panelWidth', patch.panelWidth);
      set(patch);
    },

    escape() {
      const s = get();
      if (s.popover) return set({ popover: null });
      if (s.paletteOpen || s.helpOpen) return set({ paletteOpen: false, helpOpen: false });
      if (s.editing) return set({ editing: null });
      if (s.trayOpen) return set({ trayOpen: false });
      if (s.outlineOpen) return set({ outlineOpen: false });
      const sel = s.selectedId;
      if (sel && (s.expanded.has(sel) || testsOpen(s, sel))) {
        const expanded = new Set(s.expanded);
        expanded.delete(sel);
        const testsToggled = new Set(s.testsToggled);
        if (s.allTests) testsToggled.add(sel);
        else testsToggled.delete(sel);
        return set({ expanded, testsToggled });
      }
      if (sel) return get().select(null);
      const index = s.index;
      const last = s.lastFocus ? index?.byId.get(s.lastFocus) : undefined;
      const parent = last?.parentId ? index?.byId.get(last.parentId) : undefined;
      camera.record(null);
      if (parent && parent.kind === 'area') {
        camera.flyTo(parent.id);
        set({ lastFocus: parent.id });
      } else {
        camera.fit();
        set({ lastFocus: null });
      }
    },

    back() {
      const entry = camera.back(get().selectedId);
      if (entry) get().select(entry.selectedId, { silent: true });
    },
    forward() {
      const entry = camera.forward(get().selectedId);
      if (entry) get().select(entry.selectedId, { silent: true });
    },

    async tidy() {
      const s = get();
      const index = s.index;
      if (!index || s.laying) return;
      set({ laying: true });
      try {
        const positions = await autoLayout(index, (id) => collapsedHeight(index, id));
        set((st) => ({
          positions,
          pinned: [],
          laying: false,
          undoStack: [
            ...st.undoStack,
            {
              kind: 'layout' as const,
              before: s.positions,
              after: positions,
              pinnedBefore: s.pinned,
              pinnedAfter: [],
            },
          ],
          redoStack: [],
        }));
        persistLayout();
        setTimeout(() => camera.fit(), 280);
      } catch (err) {
        set({ laying: false });
        get().toast(`Layout failed: ${String(err)}`, true);
      }
    },

    moveNode(id, position) {
      const s = get();
      const before = s.positions;
      const after = { ...before, [id]: position };
      const pinnedAfter = s.pinned.includes(id) ? s.pinned : [...s.pinned, id];
      set({
        positions: after,
        pinned: pinnedAfter,
        undoStack: [
          ...s.undoStack,
          { kind: 'layout' as const, before, after, pinnedBefore: s.pinned, pinnedAfter },
        ].slice(-100),
        redoStack: [],
      });
      const d = draft();
      const op = d?.operations.find((o) => o.id === id && o.type === 'add_block');
      if (d && op) {
        const next = {
          ...d,
          operations: d.operations.map((o) =>
            o.id === id && o.type === 'add_block' ? { ...o, position } : o,
          ),
        };
        upsertChange(next);
        void s.source?.saveChange(next).catch(() => {});
      }
      persistLayout();
    },

    toast(text, error) {
      const id = ++toastId;
      set((s) => ({ toasts: [...s.toasts, { id, text, error }].slice(-3) }));
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), error ? 6000 : 2600);
    },

    addOp(op) {
      mutate((ops) => [...ops, op]);
    },
    removeOp(opId) {
      mutate((ops) => ops.filter((o) => o.id !== opId));
    },
    setDraftTitle(title) {
      const d = draft();
      if (!d) return;
      const next = { ...d, title };
      upsertChange(next);
      void get()
        .source?.saveChange(next)
        .catch(() => {});
    },
    requestRemove(targetId, targetType, label, ownerId) {
      const mark = get().marks.get(targetId);
      const ops = draft()?.operations ?? [];
      const own = ops.find((o) => o.id === targetId);
      if (own)
        return mutate((list) =>
          list.filter(
            (o) =>
              o.id !== targetId && !(o.type === 'add_edge' && (o.from === targetId || o.to === targetId)),
          ),
        );
      const sub = targetId.match(/^(.*):b(\d+)$/);
      if (sub) {
        const parent = ops.find((o) => o.id === sub[1]);
        if (parent && (parent.type === 'add_block' || parent.type === 'add_edge')) {
          const n = Number(sub[2]);
          return mutate((list) =>
            list.map((o) =>
              o.id === parent.id ? { ...parent, bullets: parent.bullets.filter((_, i) => i !== n) } : o,
            ),
          );
        }
      }
      if (mark?.state === 'removed') return mutate((list) => list.filter((o) => o.id !== mark.opId));
      mutate((list) => [
        ...list,
        { id: freshId('op'), type: 'remove', targetId, targetType, ownerId, label },
      ]);
    },
    requestRename(targetId, name) {
      const clean = name.trim();
      if (!clean) return;
      const ops = draft()?.operations ?? [];
      const own = ops.find((o) => o.id === targetId && o.type === 'add_block');
      if (own)
        return mutate((list) =>
          list.map((o) => (o.id === targetId && o.type === 'add_block' ? { ...o, name: clean } : o)),
        );
      const original = get().bundle?.snapshot.nodes.find((n) => n.id === targetId)?.name ?? '';
      mutate((list) => {
        const rest = list.filter((o) => !(o.type === 'rename' && o.targetId === targetId));
        return clean === original
          ? rest
          : [...rest, { id: freshId('op'), type: 'rename', targetId, name: clean, before: original }];
      });
    },
    setBullet(ownerId, bullet, text) {
      const clean = text.trim();
      if (!clean) return;
      const ops = draft()?.operations ?? [];
      if (ops.some((o) => o.id === bullet.id && o.type === 'add_behavior')) {
        return mutate((list) =>
          list.map((o) => (o.id === bullet.id && o.type === 'add_behavior' ? { ...o, text: clean } : o)),
        );
      }
      const sub = bullet.id.match(/^(.*):b(\d+)$/);
      const parent = sub ? ops.find((o) => o.id === sub[1]) : undefined;
      if (sub && parent && (parent.type === 'add_block' || parent.type === 'add_edge')) {
        const n = Number(sub[2]);
        return mutate((list) =>
          list.map((o) =>
            o.id === parent.id
              ? { ...parent, bullets: parent.bullets.map((b, i) => (i === n ? clean : b)) }
              : o,
          ),
        );
      }
      const mark = get().marks.get(bullet.id);
      const before = mark?.before ?? bullet.text;
      mutate((list) => {
        const rest = list.filter((o) => !(o.type === 'set_behavior' && o.bulletId === bullet.id));
        return clean === before
          ? rest
          : [
              ...rest,
              {
                id: freshId('op'),
                type: 'set_behavior',
                targetId: ownerId,
                bulletId: bullet.id,
                text: clean,
                before,
              },
            ];
      });
    },
    addBullet(targetId, text) {
      const clean = text.trim();
      if (!clean) return;
      const ops = draft()?.operations ?? [];
      const own = ops.find((o) => o.id === targetId);
      if (own && (own.type === 'add_block' || own.type === 'add_edge')) {
        return mutate((list) =>
          list.map((o) => (o.id === own.id ? { ...own, bullets: [...own.bullets, clean] } : o)),
        );
      }
      mutate((list) => [...list, { id: freshId('op'), type: 'add_behavior', targetId, text: clean }]);
    },
    pinBullet(ownerId, bullet) {
      const s = get();
      if (!s.bundle) return;
      const notes = {
        ...s.bundle.notes,
        bullets: {
          ...s.bundle.notes.bullets,
          [ownerId]: [
            ...(s.bundle.notes.bullets[ownerId] ?? []),
            { ...bullet, id: freshId('bullet'), origin: 'authored' as const },
          ],
        },
        dismissed: [...s.bundle.notes.dismissed, bullet.id],
      };
      set({ bundle: { ...s.bundle, notes } });
      s.source?.saveNotes(notes);
      rebuild();
    },
    dismissBullet(bulletId) {
      const s = get();
      if (!s.bundle) return;
      const notes = { ...s.bundle.notes, dismissed: [...s.bundle.notes.dismissed, bulletId] };
      set({ bundle: { ...s.bundle, notes } });
      s.source?.saveNotes(notes);
      rebuild();
    },

    undo() {
      const s = get();
      const entry = s.undoStack.at(-1);
      if (!entry) return;
      set({ undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, entry] });
      if (entry.kind === 'ops') writeDraft(entry.before, false);
      else {
        set({ positions: entry.before, pinned: entry.pinnedBefore });
        persistLayout();
      }
    },
    redo() {
      const s = get();
      const entry = s.redoStack.at(-1);
      if (!entry) return;
      set({ redoStack: s.redoStack.slice(0, -1), undoStack: [...s.undoStack, entry] });
      if (entry.kind === 'ops') writeDraft(entry.after, false);
      else {
        set({ positions: entry.after, pinned: entry.pinnedAfter });
        persistLayout();
      }
    },

    async transition(id, action, body) {
      const source = get().source;
      if (!source) return;
      try {
        const change = await source.transition(id, action, body);
        upsertChange(change);
        set({
          activeChangeId: change.id,
          undoStack: action === 'submit' ? [] : get().undoStack,
          redoStack: [],
        });
        if (action === 'accept' || action === 'reject' || action === 'revise')
          set({ review: null, showBefore: false });
        rebuild();
      } catch (err) {
        get().toast(err instanceof Error ? err.message : String(err), true);
      }
    },
    async patchPlan(id, patch) {
      try {
        const change = await get().source!.patchPlan(id, patch);
        upsertChange(change);
      } catch (err) {
        get().toast(err instanceof Error ? err.message : String(err), true);
      }
    },
    async discardChange(id) {
      const s = get();
      set({
        changes: s.changes.filter((c) => c.id !== id),
        activeChangeId: s.activeChangeId === id ? null : s.activeChangeId,
      });
      await s.source?.discardChange(id).catch(() => {});
      rebuild();
    },
    async enterReview(id) {
      try {
        const review = await get().source!.review(id);
        set({
          review,
          showBefore: false,
          activeChangeId: id,
          trayOpen: false,
          panelOpen: true,
          selectedId: null,
        });
        rebuild();
        const changed = review.findings.flatMap((f) => f.targetIds);
        const index = get().index;
        const blocks = [
          ...new Set(
            changed
              .map(
                (t) =>
                  index?.blockOf.get(t) ??
                  (index?.edgeById.get(t) ? index.blockOf.get(index.edgeById.get(t)!.from) : undefined),
              )
              .filter((b): b is Id => Boolean(b)),
          ),
        ];
        if (blocks.length) setTimeout(() => camera.flyTo(blocks), 320);
      } catch (err) {
        get().toast(err instanceof Error ? err.message : String(err), true);
      }
    },
    exitReview() {
      set({ review: null, showBefore: false });
      rebuild();
    },
    setShowBefore(on) {
      if (!get().review || get().showBefore === on) return;
      set({ showBefore: on });
      rebuild();
    },
    async runChecks() {
      try {
        set({ checksRunning: true });
        await get().source!.runChecks();
      } catch (err) {
        set({ checksRunning: false });
        get().toast(err instanceof Error ? err.message : String(err), true);
      }
    },
  };
});

// ---- Selectors ----

export function testsOpen(s: Pick<DeckState, 'allTests' | 'testsToggled'>, id: Id): boolean {
  return s.allTests !== s.testsToggled.has(id);
}

/** Pass and fail come only from a run on the current tree. An older run counts as not run. */
export function currentRun(s: Pick<DeckState, 'bundle' | 'review' | 'showBefore'>): TestRun | null {
  if (s.review) return s.showBefore ? null : s.review.testRun;
  const run = s.bundle?.testRun;
  return run && run.treeHash === s.bundle?.treeHash ? run : null;
}

export const useLevel = (): Level => useDeck((s) => levelOf(s.band));

export function draftOf(s: Pick<DeckState, 'changes'>): Change | undefined {
  return s.changes.find((c) => c.state === 'draft');
}

export function crumbsFor(s: Pick<DeckState, 'index' | 'selectedId'>) {
  const index = s.index;
  if (!index) return [];
  if (!s.selectedId) return [index.system];
  const link = index.linkById.get(s.selectedId);
  return pathTo(index, link ? link.from : s.selectedId);
}

export function visualState(s: Pick<DeckState, 'marks' | 'findings'>, id: Id): string | undefined {
  return s.findings.get(id) ?? s.marks.get(id)?.state;
}
