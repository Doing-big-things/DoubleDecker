import {
  type Bullet,
  buildIndex,
  buildSimple,
  type Change,
  type ChangeOp,
  connectionKey,
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
  requirementTests,
  type ServerEvent,
  type SimpleDeck,
  type TestRun,
  withGroups,
  withNotes,
} from '@decker/deck-model';
import { create } from 'zustand';
import { connect, type DeckSource, type Transition } from '../data/source';
import { camera, type Level, levelOf, zoomStepOf } from '../map/camera';
import { autoLayout, countMissing, makeRoom, type Positions, placeMissing, settle } from '../model/layout';
import { collapsedHeight } from '../model/measure';
import { applyOps, type Marks } from '../model/pending';
import {
  fontsChanged,
  type LabelSize,
  labelSize,
  layoutSignature,
  layoutSimple,
  linkRequested,
  type PartPlan,
  planPart,
  type SimpleLayout,
  withRequests,
} from '../model/simple';

export type PanelTab = 'overview' | 'tests' | 'source' | 'diff';

/** Simple shows a few large parts in plain words. Advanced is the full map (spec §3.13). */
export type View = 'simple' | 'advanced';

/** What is happening to a part: the most pressing state among the changes that touch it. */
export interface PartWork {
  kind: 'failed' | 'needs_you' | 'review' | 'building' | 'requested';
  changeId: Id;
  count: number;
}

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
  | {
      kind: 'layout';
      before: Positions;
      after: Positions;
      pinnedBefore: Id[];
      pinnedAfter: Id[];
      groupsBefore?: Groups;
      groupsAfter?: Groups;
    };

/** Blocks drawn in an area other than the one their code lives in, by block id (spec §3.8). */
export type Groups = Record<Id, Id>;

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
  groups: Groups;
  /** The area a block being dragged would land in, when that is not the one it is in. */
  dropArea: Id | null;
  laying: boolean;
  layoutEpoch: number;

  view: View;
  /** What to look at once the other view is on screen: set by drilling in. */
  viewFocus: Id | Id[] | null;
  simple: SimpleDeck | null;
  simplePlans: Map<Id, PartPlan>;
  simpleLabels: Map<string, LabelSize>;
  /** Where everything that is built sits. Requests are drawn over it and move nothing. */
  simpleBase: SimpleLayout | null;
  simpleLayout: SimpleLayout | null;
  simpleSig: string;
  /** Review findings and pending requests, rolled up to parts and connections. */
  simpleState: Map<Id, string>;
  simpleChanged: Set<Id> | null;
  simpleWork: Map<Id, PartWork>;
  /** The part whose "ask for something new" box is open. */
  asking: Id | null;

  theme: 'dark' | 'light';
  band: number;
  /** Zoom in steps of 4%, for the simple view's cards. */
  zoomStep: number;
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
  /** Switch between the simple and the advanced view. `focus` is what to look at on arrival. */
  setView(view: View, opts?: { focus?: Id | Id[] }): void;
  /** Ask for a new connection between two parts, in plain words. */
  askConnection(from: Id, to: Id, text: string): void;
  /** Say what a part is for, or what a connection carries, in your own words. Empty restores the derived text. */
  describePlain(target: { part: Id } | { from: Id; to: Id }, text: string): void;
  select(
    id: Id | null,
    opts?: { fly?: boolean; op?: Id | null; keepTab?: boolean; silent?: boolean; later?: boolean },
  ): void;
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
  /** Move a block. With `toArea`, also regroup it into that area: a change to the picture only. */
  moveNode(id: Id, position: Point, toArea?: Id): void;
  /** Draw a regrouped block back in the area its code lives in. */
  ungroup(id: Id): void;
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
let panelTimer: ReturnType<typeof setTimeout> | undefined;
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

function initialView(): View {
  const asked = new URLSearchParams(location.search).get('view');
  if (asked === 'simple' || asked === 'advanced') return asked;
  return readLocal<string>('dd:view', 'simple') === 'advanced' ? 'advanced' : 'simple';
}

/** In the simple view, hovering a part lights the parts it talks to and the lines between them. */
function litSimple(deck: SimpleDeck, id: Id): Set<Id> | null {
  const link = deck.linkById.get(id);
  if (link) return new Set([link.id, link.from, link.to]);
  if (!deck.partById.has(id)) return null;
  const out = new Set<Id>([id]);
  for (const l of deck.links) {
    if (l.wiring || (l.from !== id && l.to !== id)) continue;
    // A connection to common ground is not drawn, and the two parts still belong together.
    out.add(l.from).add(l.to);
    if (!l.hidden) out.add(l.id);
  }
  return out;
}

const WORK_RANK: Record<PartWork['kind'], number> = {
  failed: 0,
  needs_you: 1,
  review: 2,
  building: 3,
  requested: 4,
};

function workOf(change: Change): PartWork['kind'] | null {
  switch (change.state) {
    case 'draft':
      return 'requested';
    case 'planning':
    case 'implementing':
    case 'checking':
      return 'building';
    case 'needs_answer':
    case 'plan_ready':
      return 'needs_you';
    case 'in_review':
      return 'review';
    case 'failed':
      return 'failed';
    default:
      return null;
  }
}

/** The parts an operation is about. */
function partsOfOp(deck: SimpleDeck, index: DeckIndex, op: ChangeOp): Id[] {
  const home = (id: Id | undefined): Id | undefined => {
    if (!id) return undefined;
    const direct = deck.partOf.get(id);
    if (direct) return direct;
    const edge = index.edgeById.get(id);
    if (edge) return deck.partOf.get(edge.from);
    const link = index.linkById.get(id);
    return link ? deck.partOf.get(link.from) : undefined;
  };
  const ids =
    op.type === 'add_edge'
      ? [home(op.from), home(op.to)]
      : op.type === 'add_block'
        ? [home(op.id) ?? home(op.parentId)]
        : op.type === 'remove'
          ? [home(op.targetId) ?? home(op.ownerId)]
          : [home(op.targetId)];
  return ids.filter((x): x is Id => Boolean(x));
}

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
    const groups: Groups = {};
    for (const [id, area] of Object.entries(s.groups)) if (real.has(id) && real.has(area)) groups[id] = area;
    s.source.saveLayout({
      version: 1,
      positions,
      pinned: s.pinned.filter((id) => real.has(id)),
      ...(Object.keys(groups).length ? { groups } : {}),
    });
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
        // The arrow that implements a requested one is drawn as it will be once accepted:
        // with the kind and label that were asked for, and the tests its requirements named.
        const asked = new Map<Id, Partial<DeckSnapshot['edges'][number]>>();
        for (const op of change?.operations ?? []) {
          if (op.type !== 'add_edge') continue;
          const real = s.review.findings.find((f) => f.opId === op.id && f.kind === 'implemented')
            ?.targetIds[0];
          if (!real) continue;
          const tests = requirementTests(change!.plan, op.id, change!.operations.length);
          asked.set(real, {
            kind: op.kind,
            ...(op.label ? { label: op.label } : {}),
            ...(tests.length ? { tests } : {}),
          });
        }
        if (asked.size)
          base = {
            ...base,
            edges: base.edges.map((e) => (asked.has(e.id) ? { ...e, ...asked.get(e.id) } : e)),
          };
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
    const index = buildIndex(withGroups(applied.snapshot, s.groups));

    // The simple view is the same deck seen from further away, so it is rebuilt with it.
    const simple = buildSimple(index, s.bundle.notes);
    const simplePlans = new Map(simple.parts.map((p) => [p.id, planPart(simple, p, applied.marks)]));
    const simpleLabels = new Map(
      simple.links.filter((l) => !l.hidden).map((l) => [l.id, labelSize(l.label.text)]),
    );
    const simpleState = new Map<Id, string>();
    const rank = (kind: string) => FINDING_RANK[kind as FindingKind] ?? 9;
    const roll = (id: Id | undefined, kind: string) => {
      if (!id) return;
      const cur = simpleState.get(id);
      if (!cur || rank(kind) < rank(cur)) simpleState.set(id, kind);
    };
    for (const [id, kind] of findings) {
      if (kind === 'supported' || kind === 'untested') continue;
      roll(simple.partOf.get(id), kind);
      roll(simple.linkOf.get(id), kind);
    }
    if (s.review && !s.showBefore)
      for (const op of ops) for (const p of partsOfOp(simple, index, op)) roll(p, 'missing');
    let simpleChanged: Set<Id> | null = null;
    if (changedIds) {
      simpleChanged = new Set();
      for (const id of changedIds) {
        const part = simple.partOf.get(id);
        if (part) simpleChanged.add(part);
        const link = simple.linkOf.get(id);
        if (link) simpleChanged.add(link).add(simple.linkById.get(link)!.from);
      }
      for (const id of simpleState.keys()) simpleChanged.add(id);
    }
    const simpleWork = new Map<Id, PartWork>();
    for (const c of s.changes) {
      const kind = workOf(c);
      if (!kind) continue;
      for (const op of c.operations) {
        for (const part of partsOfOp(simple, index, op)) {
          const cur = simpleWork.get(part);
          if (cur && cur.changeId === c.id) cur.count += 1;
          else if (!cur || WORK_RANK[kind] < WORK_RANK[cur.kind])
            simpleWork.set(part, { kind, changeId: c.id, count: 1 });
        }
      }
    }
    const asked = new Set(
      simple.links.filter((l) => !l.hidden && linkRequested(l, applied.marks) === 'all').map((l) => l.id),
    );
    const simpleSig = layoutSignature(simple, simplePlans, simpleLabels, asked);

    const exists = (id: Id | null) =>
      id !== null &&
      (index.byId.has(id) ||
        index.linkById.has(id) ||
        simple.linkById.has(id) ||
        index.areaLinks.some((l) => l.id === id));
    set({
      index,
      marks: applied.marks,
      findings,
      changedIds,
      simple,
      simplePlans,
      simpleLabels,
      simpleState,
      simpleChanged,
      simpleWork,
      simpleSig,
      simpleLayout: s.simpleBase ? withRequests(s.simpleBase, simple, simpleLabels) : null,
      selectedId: exists(s.selectedId) ? s.selectedId : null,
      focusOpId: s.focusOpId && index.byId.has(s.focusOpId) ? s.focusOpId : null,
    });
    if (simpleSig !== s.simpleSig)
      layoutSimple(simple, simplePlans, simpleLabels, asked)
        .then((simpleBase) => {
          const now = get();
          if (now.simpleSig !== simpleSig || !now.simple) return;
          set({ simpleBase, simpleLayout: withRequests(simpleBase, now.simple, now.simpleLabels) });
        })
        .catch((err: unknown) => get().toast(`Layout failed: ${String(err)}`, true));
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
      groups: first ? (bundle.layout?.groups ?? {}) : prev.groups,
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
            [event.changeId]: [...(s.progress[event.changeId] ?? []), event.text].slice(-1000),
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
      case 'connections': {
        const s = get();
        if (!s.bundle) break;
        set({ bundle: { ...s.bundle, snapshot: { ...s.bundle.snapshot, connections: event.connections } } });
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
    groups: {},
    dropArea: null,
    laying: false,
    layoutEpoch: 0,

    view: initialView(),
    viewFocus: null,
    simple: null,
    simplePlans: new Map(),
    simpleLabels: new Map(),
    simpleBase: null,
    simpleLayout: null,
    simpleSig: '',
    simpleState: new Map(),
    simpleChanged: null,
    simpleWork: new Map(),
    asking: null,

    theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
    band: 12,
    zoomStep: 25,
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
        // Listen before loading. What the server pushes while the map is being fetched is
        // kept and applied once the map is there, so nothing is lost in between.
        const early: ServerEvent[] = [];
        let loaded = false;
        source.subscribe((event) => {
          if (loaded) onEvent(event);
          else early.push(event);
        });
        await source.listening();
        const bundle = await source.load();
        // A part's size comes from measuring its text, so the text face has to be there first.
        await Promise.race([
          Promise.all([
            document.fonts.load('400 14.5px "Inter Variable"'),
            document.fonts.load('650 18px "Inter Variable"'),
          ]),
          new Promise((resolve) => setTimeout(resolve, 800)),
        ]).catch(() => {});
        fontsChanged();
        applyBundle(bundle, true);
        loaded = true;
        for (const event of early) onEvent(event);
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
      // A selection belongs to one view. Choosing something only the other view shows goes
      // there: a block from the simple view, a plain connection from the advanced one.
      const inSimple = Boolean(id && s.simple && (s.simple.partById.has(id) || s.simple.linkById.has(id)));
      const crosses = id !== null && (s.view === 'simple' ? !inSimple : Boolean(s.simple?.linkById.has(id)));
      if (crosses) {
        const view: View = s.view === 'simple' ? 'advanced' : 'simple';
        writeLocal('dd:view', view);
        set({
          view,
          viewFocus: opts.fly ? id : null,
          hoverId: null,
          lit: null,
          asking: null,
          zoomStep: zoomStepOf(camera.viewport().zoom),
        });
      } else if (opts.fly && id) {
        camera.record(s.selectedId);
        camera.flyTo(id);
      }
      set({
        selectedId: id,
        focusOpId: opts.op ?? null,
        lastFocus: id ?? s.lastFocus,
        panelOpen: id ? (opts.later ? s.panelOpen : true) : s.review ? s.panelOpen : false,
        panelTab: changed && !opts.keepTab ? 'overview' : s.panelTab,
        peek: changed ? null : s.peek,
        editing: null,
      });
      // Opening the panel narrows the canvas. A part chosen near its right edge is kept in
      // sight. A click on the canvas opens the panel a moment later: otherwise the panel
      // would slide under the second click of a double-click, which is how a part is opened.
      if (id && !crosses && !opts.fly && s.view === 'simple' && s.simple?.partById.has(id)) {
        clearTimeout(panelTimer);
        panelTimer = setTimeout(
          () => {
            const now = get();
            if (now.selectedId !== id || now.view !== 'simple') return;
            if (!now.panelOpen) set({ panelOpen: true });
            // By the time the panel has opened, the selection or the view may have moved on.
            // A reveal for what is no longer chosen would stop the camera on its way elsewhere.
            setTimeout(() => {
              const then = get();
              if (then.selectedId === id && then.view === 'simple') camera.reveal(id);
            }, 90);
          },
          opts.later && !s.panelOpen ? 260 : 0,
        );
      }
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
        const { index, view, simple } = get();
        if (view === 'simple' && simple) set({ hoverId: id, lit: litSimple(simple, id) });
        else if (index) set({ hoverId: id, lit: litFor(index, id) });
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
      if (s.asking) return set({ asking: null });
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
      if (s.view === 'simple') {
        camera.record(null);
        camera.fit();
        return set({ lastFocus: null });
      }
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

    setView(view, opts = {}) {
      const s = get();
      if (view === s.view) {
        if (opts.focus) camera.flyTo(opts.focus);
        return;
      }
      writeLocal('dd:view', view);
      // Opening one thing selects it. Otherwise the selection follows where it can: a block's
      // part in the simple view, nothing for a connection that only one view draws.
      const sel = typeof opts.focus === 'string' ? opts.focus : s.selectedId;
      const selectedId = !sel
        ? null
        : view === 'simple'
          ? (s.simple?.partOf.get(sel) ?? null)
          : s.index?.byId.has(sel)
            ? sel
            : null;
      clearTimeout(hoverTimer);
      set({
        view,
        viewFocus: opts.focus ?? null,
        zoomStep: zoomStepOf(camera.viewport().zoom),
        selectedId,
        focusOpId: null,
        panelOpen: selectedId ? s.panelOpen : Boolean(s.review) && s.panelOpen,
        peek: null,
        hoverId: null,
        lit: null,
        asking: null,
        popover: null,
        editing: null,
      });
    },

    askConnection(from, to, text) {
      const label = text.trim().replace(/\s+/g, ' ').slice(0, 120);
      if (!label || from === to) return;
      mutate((ops) => [
        ...ops,
        { id: freshId('op'), type: 'add_edge', from, to, kind: 'call', label, bullets: [] },
      ]);
    },

    describePlain(target, text) {
      const s = get();
      if (!s.bundle) return;
      const clean = text.trim().replace(/\s+/g, ' ');
      const plain = s.bundle.notes.plain ?? {};
      const summaries = { ...(plain.summaries ?? {}) };
      const connections = { ...(plain.connections ?? {}) };
      if ('part' in target) {
        if (clean) summaries[target.part] = clean.slice(0, 400);
        else delete summaries[target.part];
      } else {
        const key = connectionKey(target.from, target.to);
        if (clean) connections[key] = clean.slice(0, 200);
        else delete connections[key];
      }
      const notes = { ...s.bundle.notes, plain: { summaries, connections } };
      set({ bundle: { ...s.bundle, notes } });
      s.source?.saveNotes(notes);
      rebuild();
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

    moveNode(id, position, toArea) {
      const s = get();
      const node = s.index?.byId.get(id);
      if (!s.index || !node) return;
      const before = s.positions;
      const d = draft();
      const op = d?.operations.find((o) => o.id === id && o.type === 'add_block');
      const regroup = toArea !== undefined && node.kind === 'block' && toArea !== node.parentId && !s.review;
      let groups = s.groups;
      if (regroup && d && op) {
        // A block that is only requested so far: where it is asked for is part of the request.
        upsertChange({
          ...d,
          operations: d.operations.map((o) =>
            o.id === id && o.type === 'add_block' ? { ...o, parentId: toArea } : o,
          ),
        });
      } else if (regroup) {
        const home = s.bundle?.snapshot.nodes.find((n) => n.id === id)?.parentId;
        groups = { ...groups };
        if (toArea === home) delete groups[id];
        else groups[id] = toArea;
      }
      if (regroup) {
        set({ groups, positions: { ...before, [id]: position } });
        rebuild();
      }
      // The block comes to rest clear of its neighbours, and an area it stretched makes room for itself.
      const index = get().index ?? s.index;
      const rest = (x: Id) => collapsedHeight(index, x);
      const parentId = index.byId.get(id)?.parentId ?? index.system.id;
      const placed = settle(index, before, rest, parentId, id, position);
      const after = makeRoom(index, { ...before, [id]: placed }, rest, parentId);
      const pinnedAfter = s.pinned.includes(id) ? s.pinned : [...s.pinned, id];
      set({
        positions: after,
        pinned: pinnedAfter,
        dropArea: null,
        undoStack: [
          ...s.undoStack,
          {
            kind: 'layout' as const,
            before,
            after,
            pinnedBefore: s.pinned,
            pinnedAfter,
            groupsBefore: s.groups,
            groupsAfter: groups,
          },
        ].slice(-100),
        redoStack: [],
      });
      const now = draft();
      if (now && op) {
        const next = {
          ...now,
          operations: now.operations.map((o) =>
            o.id === id && o.type === 'add_block' ? { ...o, position: placed } : o,
          ),
        };
        upsertChange(next);
        void s.source?.saveChange(next).catch(() => {});
      }
      persistLayout();
      if (regroup && !op) {
        const area = index.byId.get(toArea)?.name ?? 'another area';
        get().toast(`${node.name} is now drawn in ${area}. Its code has not moved.`);
      }
    },

    ungroup(id) {
      const s = get();
      if (!s.groups[id]) return;
      const groups = { ...s.groups };
      delete groups[id];
      const positions = { ...s.positions };
      delete positions[id];
      set({ groups, positions });
      rebuild(); // places it afresh in the area its code lives in
      set((st) => ({
        undoStack: [
          ...st.undoStack,
          {
            kind: 'layout' as const,
            before: s.positions,
            after: st.positions,
            pinnedBefore: s.pinned,
            pinnedAfter: st.pinned,
            groupsBefore: s.groups,
            groupsAfter: groups,
          },
        ].slice(-100),
        redoStack: [],
      }));
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
        set({ positions: entry.before, pinned: entry.pinnedBefore, groups: entry.groupsBefore ?? s.groups });
        if (entry.groupsBefore !== entry.groupsAfter) rebuild();
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
        set({ positions: entry.after, pinned: entry.pinnedAfter, groups: entry.groupsAfter ?? s.groups });
        if (entry.groupsBefore !== entry.groupsAfter) rebuild();
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
        const simple = get().view === 'simple' ? get().simple : null;
        const targets = simple
          ? [...new Set(blocks.map((b) => simple.partOf.get(b)).filter((p): p is Id => Boolean(p)))]
          : blocks;
        if (targets.length) setTimeout(() => camera.flyTo(targets), 320);
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
  const path = pathTo(index, link ? link.from : s.selectedId);
  return path.length ? path : [index.system];
}

export function visualState(s: Pick<DeckState, 'marks' | 'findings'>, id: Id): string | undefined {
  return s.findings.get(id) ?? s.marks.get(id)?.state;
}
