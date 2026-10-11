// Reconciliation (spec §6.4): compare the base snapshot with the candidate snapshot, then
// explain the difference using the request. The request and the base are never rewritten
// to match what the agent built.
import {
  type ChangeOp,
  type CheckResult,
  type DeckIndex,
  type DeckNode,
  type DeckSnapshot,
  type Finding,
  type Id,
  type Plan,
  type TestDelta,
  type TestStatus,
  buildIndex,
  describeOp,
  hashId,
} from '@decker/deck-model';

export interface ReconcileInput {
  base: DeckSnapshot;
  candidate: DeckSnapshot;
  operations: ChangeOp[];
  plan?: Plan;
  checks: CheckResult[];
  results: Record<Id, TestStatus>;
  failures: Record<Id, string>;
  /** A revert candidate: every difference is the point, so nothing is unrequested. */
  reverts?: boolean;
}

export interface Reconciled {
  findings: Finding[];
  changedIds: Id[];
  testDelta: TestDelta;
  blockers: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const hashes = (n: DeckNode) => n.source.map((s) => `${s.path}:${s.hash}`).join('|');

export function reconcile(input: ReconcileInput): Reconciled {
  const base = buildIndex(input.base);
  const cand = buildIndex(input.candidate);
  const ops = input.operations;
  const findings: Finding[] = [];
  const changed = new Set<Id>();
  const explained = new Set<Id>(); // blocks a change was expected to touch
  const claimedBlocks = new Set<Id>();
  const claimedLinks = new Set<string>();
  const targetsOf = new Map<Id, Id[]>();

  const finding = (f: Omit<Finding, 'id'>) => {
    findings.push({ ...f, id: hashId('finding', `${findings.length}:${f.kind}:${f.text}`) });
    for (const id of f.targetIds) changed.add(id);
  };

  // New blocks first, so arrows to and from a requested block can be resolved.
  const realBlock = new Map<Id, Id>();
  for (const op of ops) {
    if (op.type !== 'add_block') continue;
    const match = cand.blocks.find((b) => !base.byId.has(b.id) && !claimedBlocks.has(b.id) && norm(b.name) === norm(op.name));
    if (match) {
      realBlock.set(op.id, match.id);
      claimedBlocks.add(match.id);
      explained.add(match.id);
      targetsOf.set(op.id, [match.id]);
      finding({ kind: 'implemented', text: describeOp(base, op, ops), opId: op.id, targetIds: [match.id] });
    } else finding({ kind: 'missing', text: describeOp(base, op, ops), detail: `No new block named ${op.name} was found in the candidate.`, opId: op.id, targetIds: [] });
  }
  const blockIn = (index: DeckIndex, id: Id): Id | undefined => realBlock.get(id) ?? index.blockOf.get(id) ?? (index.byId.get(id)?.kind === 'block' ? id : undefined);

  for (const op of ops) {
    const text = describeOp(base, op, ops);
    switch (op.type) {
      case 'add_edge': {
        const a = blockIn(cand, op.from) ?? blockIn(base, op.from);
        const b = blockIn(cand, op.to) ?? blockIn(base, op.to);
        if (a) explained.add(a);
        if (b) explained.add(b);
        const link = a && b ? cand.linkById.get(`lnk:${a}:${b}`) : undefined;
        if (link) {
          const before = new Set((base.linkById.get(link.id)?.edges ?? []).map((e) => e.id));
          const fresh = link.edges.filter((e) => !before.has(e.id)).map((e) => e.id);
          claimedLinks.add(link.id);
          targetsOf.set(op.id, fresh.length ? fresh : link.edges.map((e) => e.id));
          finding({ kind: 'implemented', text, detail: fresh.length ? undefined : 'This arrow was already in the code.', opId: op.id, targetIds: targetsOf.get(op.id)! });
        } else finding({ kind: 'missing', text, detail: 'No call between these blocks was found in the candidate.', opId: op.id, targetIds: [] });
        break;
      }
      case 'rename': {
        const block = base.blockOf.get(op.targetId);
        if (block) explained.add(block);
        const node = cand.byId.get(op.targetId);
        if (node && norm(node.name.split('.').at(-1)!) === norm(op.name)) {
          finding({ kind: 'implemented', text, opId: op.id, targetIds: [op.targetId] });
        } else {
          const kind = base.byId.get(op.targetId)?.kind;
          const other = input.candidate.nodes.find((n) => n.kind === kind && !base.byId.has(n.id) && norm(n.name.split('.').at(-1)!) === norm(op.name));
          if (other && !node) {
            const b = cand.blockOf.get(other.id);
            if (b) claimedBlocks.add(b);
            finding({ kind: 'implemented', text, detail: 'It came back under a new identity, so its position and notes did not follow.', opId: op.id, targetIds: [other.id] });
          } else finding({ kind: 'missing', text, opId: op.id, targetIds: node ? [op.targetId] : [] });
        }
        break;
      }
      case 'remove': {
        if (op.targetType === 'edge') {
          const link = base.linkById.get(op.targetId);
          if (link) explained.add(link.from).add(link.to);
          if (cand.linkById.has(op.targetId)) finding({ kind: 'missing', text, detail: 'The arrow is still in the code.', opId: op.id, targetIds: cand.linkById.get(op.targetId)!.edges.map((e) => e.id) });
          else finding({ kind: 'implemented', text, opId: op.id, targetIds: [] });
        } else if (op.targetType === 'node') {
          const block = base.blockOf.get(op.targetId);
          if (block) explained.add(block);
          if (cand.byId.has(op.targetId)) finding({ kind: 'missing', text, detail: 'It is still in the code.', opId: op.id, targetIds: [op.targetId] });
          else finding({ kind: 'implemented', text, opId: op.id, targetIds: block && cand.byId.has(block) ? [block] : [] });
        } else {
          const owner = op.ownerId ? base.blockOf.get(op.ownerId) : undefined;
          if (owner) explained.add(owner);
        }
        break;
      }
      case 'set_behavior':
      case 'add_behavior': {
        const block = base.blockOf.get(op.targetId) ?? realBlock.get(op.targetId);
        if (block) explained.add(block);
        const edge = base.edgeById.get(op.targetId);
        if (edge) {
          const a = base.blockOf.get(edge.from);
          const b = base.blockOf.get(edge.to);
          if (a) explained.add(a);
          if (b) explained.add(b);
        }
        break;
      }
    }
  }
  for (const file of input.plan?.files ?? []) {
    for (const index of [base, cand]) for (const b of index.blocks) if (b.source.some((s) => s.path === file)) explained.add(b.id);
  }

  // Behavior cannot be established from structure: each requirement is supported by a test,
  // contradicted by a test, or not tested. Not tested is never shown as a pass.
  const covered = new Set<Id>();
  const waivedTests = new Set<Id>();
  const contradicted: string[] = [];
  for (const r of input.plan?.requirements ?? []) {
    if (r.opId) covered.add(r.opId);
    const wanted = r.test ? norm(r.test) : '';
    const tests = wanted ? input.candidate.tests.filter((t) => norm(t.name) === wanted || norm(t.name).includes(wanted)) : [];
    const failed = tests.filter((t) => input.results[t.id] === 'failed');
    const passed = tests.filter((t) => input.results[t.id] === 'passed');
    const targetIds = [...(r.opId ? (targetsOf.get(r.opId) ?? []) : []), ...tests.flatMap((t) => t.targets.map((x) => x.id)).filter((id) => cand.byId.has(id))];
    if (failed.length) {
      if (r.waived) for (const t of failed) waivedTests.add(t.id);
      else contradicted.push(r.text);
      finding({
        kind: 'contradicted',
        text: r.text,
        detail: `${r.waived ? `Waived: ${r.waived}. ` : ''}The test “${failed[0]!.name}” failed. ${input.failures[failed[0]!.id] ?? ''}`.trim(),
        requirementId: r.id,
        opId: r.opId,
        targetIds: [...new Set(targetIds)],
        check: 'tests',
      });
    } else if (passed.length && passed.length === tests.length) {
      finding({ kind: 'supported', text: r.text, detail: `Supported by the test “${passed[0]!.name}”.`, requirementId: r.id, opId: r.opId, targetIds: [...new Set(targetIds)] });
    } else {
      const why = !r.test ? 'No test is linked to this requirement.' : tests.length === 0 ? `The test “${r.test}” was not found in the candidate.` : 'Its test was not run.';
      finding({ kind: 'untested', text: r.text, detail: why, requirementId: r.id, opId: r.opId, targetIds: [...new Set(targetIds)] });
    }
  }
  for (const op of ops) {
    const behavior = op.type === 'set_behavior' || op.type === 'add_behavior' || (op.type === 'remove' && op.targetType === 'bullet');
    if (behavior && !covered.has(op.id)) {
      const block = op.type === 'remove' ? (op.ownerId ? base.blockOf.get(op.ownerId) : undefined) : base.blockOf.get(op.targetId);
      finding({ kind: 'untested', text: describeOp(base, op, ops), detail: 'No requirement or test is linked to this behavior.', opId: op.id, targetIds: block && cand.byId.has(block) ? [block] : [] });
    }
  }

  // Structural differences, and the ones no operation explains.
  for (const b of cand.blocks) {
    const before = base.byId.get(b.id);
    if (!before) {
      changed.add(b.id);
      if (!claimedBlocks.has(b.id) && !input.reverts) finding({ kind: 'unrequested', text: `New block ${b.name}`, detail: 'Nobody asked for this block.', targetIds: [b.id] });
      continue;
    }
    if (hashes(before) === hashes(b)) continue;
    changed.add(b.id);
    for (const op of cand.children.get(b.id) ?? []) {
      const was = base.byId.get(op.id);
      if (!was || was.source[0]?.hash !== op.source[0]?.hash) changed.add(op.id);
    }
    if (input.reverts) finding({ kind: 'implemented', text: `Restores ${b.name}`, targetIds: [b.id] });
    else if (!explained.has(b.id)) finding({ kind: 'unrequested', text: `Changed ${b.name}`, detail: 'This block was changed, and no operation in the request explains why.', targetIds: [b.id] });
  }
  for (const b of base.blocks) {
    if (cand.byId.has(b.id)) continue;
    if (input.reverts) finding({ kind: 'implemented', text: `Removes ${b.name}`, targetIds: [] });
    else if (!explained.has(b.id)) finding({ kind: 'unrequested', text: `Removed block ${b.name}`, detail: 'Nobody asked to remove it.', targetIds: [] });
  }
  for (const link of cand.links) {
    const before = new Set((base.linkById.get(link.id)?.edges ?? []).map((e) => e.id));
    const fresh = link.edges.filter((e) => !before.has(e.id));
    for (const e of fresh) changed.add(e.id);
    if (fresh.length && before.size === 0 && !claimedLinks.has(link.id) && !explained.has(link.from) && !input.reverts) {
      finding({ kind: 'unrequested', text: `New arrow ${cand.byId.get(link.from)?.name} → ${cand.byId.get(link.to)?.name}`, detail: 'Nobody asked for this arrow.', targetIds: fresh.map((e) => e.id) });
    }
  }
  for (const link of base.links) {
    if (cand.linkById.has(link.id) || input.reverts) continue;
    if (!explained.has(link.from) && cand.byId.has(link.from)) {
      finding({ kind: 'unrequested', text: `Removed arrow ${base.byId.get(link.from)?.name} → ${base.byId.get(link.to)?.name}`, detail: 'Nobody asked to remove it.', targetIds: [link.from] });
    }
  }

  // Tests the agent added, changed or deleted. Weakening tests makes a candidate look better than it is.
  const baseTests = new Map(input.base.tests.map((t) => [t.id, t]));
  const candTests = new Map(input.candidate.tests.map((t) => [t.id, t]));
  const testDelta: TestDelta = {
    added: input.candidate.tests.filter((t) => !baseTests.has(t.id)),
    changed: input.candidate.tests.filter((t) => baseTests.has(t.id) && baseTests.get(t.id)!.source.hash !== t.source.hash),
    deleted: input.base.tests.filter((t) => !candTests.has(t.id)),
  };
  for (const t of [...testDelta.added, ...testDelta.changed]) for (const target of t.targets) if (cand.blockOf.has(target.id)) changed.add(cand.blockOf.get(target.id)!);
  for (const t of testDelta.deleted) for (const target of t.targets) if (cand.blockOf.has(target.id)) changed.add(cand.blockOf.get(target.id)!);

  const blockers: string[] = [];
  for (const check of input.checks) {
    if (check.skipped || check.exitCode === 0) continue;
    const failedTests = input.candidate.tests.filter((t) => input.results[t.id] === 'failed');
    const allWaived = failedTests.length > 0 && failedTests.every((t) => waivedTests.has(t.id));
    if (!allWaived) blockers.push(`The check “${check.name}” failed.`);
  }
  for (const text of contradicted) blockers.push(`Contradicted: ${text}`);

  return { findings, changedIds: [...changed], testDelta, blockers };
}
