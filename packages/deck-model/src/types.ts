// The deck model (spec §4). Language-neutral: a language adapter's whole job
// is to produce a DeckSnapshot.

export type Id = string; // opaque and stable, e.g. "blk_7f3a2c1b"

export type NodeKind = 'system' | 'area' | 'block' | 'operation' | 'data' | 'external';
export type BulletOrigin = 'declared' | 'summarized' | 'authored';
export type EdgeKind = 'call' | 'api' | 'event' | 'data' | 'dependency';
export type Coverage = 'full' | 'partial' | 'opaque';

export interface SourceRef {
  path: string;
  symbol?: string;
  startLine: number;
  endLine: number;
  hash: string; // content hash of the span
}

export interface Bullet {
  id: Id;
  text: string;
  origin: BulletOrigin;
  /** For declared bullets: whether it came from a doc comment or a humanized name. */
  basis?: 'doc' | 'name';
  derivedFrom?: SourceRef;
}

export interface DeckNode {
  id: Id;
  kind: NodeKind;
  name: string;
  parentId: Id | null;
  summary?: Bullet; // the one-line responsibility
  bullets: Bullet[];
  signature?: string; // operations and data
  source: SourceRef[];
  coverage: Coverage;
  /** 'api' for route handlers, 'entry' for entry points, 'internal' for non-exported helpers. */
  tags?: string[];
}

export interface DeckEdge {
  id: Id;
  from: Id; // operation or block; rolled up to blocks and areas for display
  to: Id;
  kind: EdgeKind;
  label?: string;
  indirect?: string; // e.g. "via StockStore" when resolved through an interface
  bullets: Bullet[];
  evidence: SourceRef[]; // the call sites or imports that establish it
  /** Titles of the tests a change linked to this arrow's requirements (spec §3.7). Never extracted. */
  tests?: string[];
}

export type GapReason = 'dynamic-call' | 'dynamic-import' | 'untyped' | 'parse-error' | 'unsupported';

export interface Gap {
  ownerId: Id; // the block that contains it
  reason: GapReason;
  source: SourceRef;
}

export interface DeckTest {
  id: Id;
  name: string; // the test's title as written
  suite: string[]; // enclosing describe titles
  source: SourceRef;
  targets: { id: Id; via: 'calls' | 'imports' | 'name' }[];
}

export interface SnapshotStats {
  files: number;
  lines: number;
  callSites: number;
  resolvedCallSites: number;
  imports: number;
  resolvedImports: number;
}

export interface DeckSnapshot {
  schemaVersion: 1;
  sourceCommit: string;
  dirty: boolean;
  adapter: { name: string; version: string; configHash: string };
  nodes: DeckNode[];
  edges: DeckEdge[];
  tests: DeckTest[];
  gaps: Gap[];
  stats?: SnapshotStats;
  /**
   * What one top-level area asks of another, in plain words, by "from>to" (spec §3.13).
   * Never extracted from code: written by a summarizer, or by hand in a fixture.
   */
  connections?: Record<string, Bullet>;
}

// ---- Evidence (not part of the snapshot; stored per commit) ----

export type TestStatus = 'passed' | 'failed' | 'skipped';

export interface CheckResult {
  name: string;
  command: string;
  exitCode: number;
  durationMs: number;
  output: string; // truncated
  skipped?: string; // reason, when the check could not run
}

export interface TestRun {
  commit: string;
  /** Hash of the working tree the run saw. A run is current only while this still matches. */
  treeHash: string;
  ranAt: string;
  results: Record<Id, TestStatus>;
  checks: CheckResult[];
}

// ---- Layout and notes (committed with the code) ----

export interface Point {
  x: number;
  y: number;
}

export interface DeckLayout {
  version: 1;
  /** Position of each area and block, relative to its parent area. */
  positions: Record<Id, Point>;
  /** Blocks and areas the engineer has placed by hand. */
  pinned: Id[];
  /**
   * Blocks the engineer has dragged into another area, by block id. This changes only the
   * picture: the code, the snapshot and what an agent is told all keep the block where it lives.
   */
  groups?: Record<Id, Id>;
}

export interface DeckNotes {
  version: 1;
  /** Authored and pinned bullets, by owning node or edge. */
  bullets: Record<Id, Bullet[]>;
  /** Summarized bullets the engineer dismissed. */
  dismissed: Id[];
  /** What an accepted arrow was asked to be: its kind and label, by edge id. */
  edges?: Record<Id, { kind: EdgeKind; label?: string; tests?: string[] }>;
  /**
   * The simple view in the engineer's own words (spec §3.13): what an area is for, by area id,
   * and what one area asks of another, by "from>to".
   */
  plain?: { summaries?: Record<Id, string>; connections?: Record<string, string> };
}

// ---- Changes (spec §3.8, §6) ----

export type ChangeOp =
  | { id: Id; type: 'set_behavior'; targetId: Id; bulletId: Id; text: string; before: string }
  | { id: Id; type: 'add_behavior'; targetId: Id; text: string }
  | {
      id: Id;
      type: 'add_edge';
      from: Id;
      to: Id;
      kind: EdgeKind;
      label?: string;
      bullets: string[];
    }
  | { id: Id; type: 'add_block'; parentId: Id; name: string; bullets: string[]; position?: Point }
  | { id: Id; type: 'rename'; targetId: Id; name: string; before: string }
  | {
      id: Id;
      type: 'remove';
      targetId: Id;
      targetType: 'node' | 'edge' | 'bullet';
      ownerId?: Id;
      label: string;
    };

export type ChangeOpType = ChangeOp['type'];

export type ChangeState =
  | 'draft'
  | 'planning'
  | 'needs_answer'
  | 'plan_ready'
  | 'implementing'
  | 'checking'
  | 'in_review'
  | 'accepted'
  | 'rejected'
  | 'failed';

export interface Requirement {
  id: Id;
  text: string; // a testable statement
  /** The operation this requirement came from, when there is one. */
  opId?: Id;
  /** Title (or fragment) of the test the plan links to this requirement. */
  test?: string;
  waived?: string; // the engineer's note, when explicitly waived
}

export interface PlanQuestion {
  id: Id;
  text: string;
  options?: string[];
  answer?: string;
}

export interface Plan {
  interpretation: string;
  requirements: Requirement[];
  files: string[];
  checks: string[];
  questions: PlanQuestion[];
  /** Limits the engineer accepted, recorded on the change and shown on the map. */
  limits: string[];
  approved: boolean;
}

export type CandidateStatus =
  | 'implementing'
  | 'checking'
  | 'in_review'
  | 'accepted'
  | 'rejected'
  | 'failed'
  | 'superseded';

export interface Candidate {
  n: number;
  branch: string;
  worktree: string;
  baseCommit: string;
  commit?: string;
  status: CandidateStatus;
  comment?: string; // the revise comment that asked for this candidate
  notes?: string; // the agent's own notes: not evidence
  checks: CheckResult[];
  error?: string;
}

export interface ChangeEvent {
  at: string;
  type: string;
  detail?: string;
}

export interface Change {
  id: Id;
  title: string;
  state: ChangeState;
  operations: ChangeOp[];
  plan?: Plan;
  candidates: Candidate[];
  events: ChangeEvent[];
  createdAt: string;
  updatedAt: string;
  /** Counts every update, so a late reply can never overwrite newer state. */
  rev?: number;
  error?: string;
  /** Set when this change exists to undo an accepted one. */
  reverts?: Id;
  /** Set on acceptance: the commits the change moved the working branch between. */
  merged?: { base: string; head: string };
}

export type FindingKind =
  | 'implemented'
  | 'missing'
  | 'contradicted'
  | 'unrequested'
  | 'supported'
  | 'untested';

export interface Finding {
  id: Id;
  kind: FindingKind;
  text: string;
  detail?: string;
  opId?: Id;
  requirementId?: Id;
  /** Nodes or edges in the candidate snapshot this finding points at. */
  targetIds: Id[];
  /** The check whose output explains it. */
  check?: string;
}

export interface FileDiff {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  patch: string;
}

export interface TestDelta {
  added: DeckTest[];
  changed: DeckTest[];
  deleted: DeckTest[];
}

export interface ReviewBundle {
  changeId: Id;
  candidate: number;
  base: DeckSnapshot;
  snapshot: DeckSnapshot;
  findings: Finding[];
  checks: CheckResult[];
  testRun: TestRun | null;
  testDelta: TestDelta;
  diff: FileDiff[];
  /** Node and edge ids that differ between base and candidate. */
  changedIds: Id[];
  canAccept: boolean;
  blockers: string[];
}

// ---- What the browser receives ----

export interface Capabilities {
  server: boolean;
  editor: boolean;
  sandbox: 'docker' | 'podman' | 'host' | 'none';
  worker: string; // 'claude', 'scripted', or 'none'
  /** The worker as shown to the engineer: for a model, which one and how hard it thinks. */
  workerLabel?: string;
  summarizer: boolean;
}

export interface DeckBundle {
  name: string;
  snapshot: DeckSnapshot;
  layout: DeckLayout | null;
  notes: DeckNotes;
  testRun: TestRun | null;
  changes: Change[];
  capabilities: Capabilities;
  /** Blocks whose source differs from the last accepted commit (§6.5). */
  changedSinceBaseline: Id[];
  /** Hash of the working tree, for deciding whether a test run is still current. */
  treeHash: string;
  /** Entities that look renamed. The engineer confirms each one on the map (spec §4.2). */
  renames?: { id: Id; from: string; to: string }[];
  /** Fixture mode only: source text by path, for the code peek. */
  sources?: Record<string, string>;
}

/** Messages pushed over WS /api/events. */
export type ServerEvent =
  | { type: 'deck'; bundle: DeckBundle }
  | { type: 'change'; change: Change }
  | { type: 'progress'; changeId: Id; text: string; at: string }
  | { type: 'summary'; nodeId: Id; summary?: Bullet; bullets: Bullet[] }
  | { type: 'connections'; connections: Record<string, Bullet> }
  | { type: 'checks'; running: boolean };

export interface AgentEvent {
  type: 'text' | 'tool' | 'question' | 'plan' | 'done' | 'error';
  text?: string;
  plan?: Plan;
}
