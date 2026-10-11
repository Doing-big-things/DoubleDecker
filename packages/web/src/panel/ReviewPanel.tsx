// Review mode (spec §3.9): the candidate on the same canvas, with every operation and
// requirement given a finding, and Accept refused while anything is contradicted.
import type { Finding, Id } from '@decker/deck-model';
import { Check, Eye, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { camera } from '../map/camera';
import { useDeck } from '../state/store';
import { DiffView } from './CodePeek';

const LABEL: Record<Finding['kind'], string> = {
  implemented: 'Implemented',
  missing: 'Missing',
  contradicted: 'Contradicted',
  unrequested: 'Unrequested',
  supported: 'Supported by a test',
  untested: 'Not tested',
};

function flyToFinding(f: Finding): void {
  const st = useDeck.getState();
  const index = st.index;
  if (!index) return;
  const blocks = new Set<Id>();
  for (const id of f.targetIds.length ? f.targetIds : f.opId ? [f.opId] : []) {
    const edge = index.edgeById.get(id);
    if (edge) {
      const a = index.blockOf.get(edge.from);
      const b = index.blockOf.get(edge.to);
      if (a) blocks.add(a);
      if (b) blocks.add(b);
    } else {
      const block = index.blockOf.get(id);
      if (block) blocks.add(block);
    }
  }
  if (blocks.size === 0) return;
  camera.record(st.selectedId);
  camera.flyTo([...blocks]);
}

export function ReviewPanel() {
  const review = useDeck((s) => s.review);
  const change = useDeck((s) => s.changes.find((c) => c.id === s.review?.changeId));
  const [openCheck, setOpenCheck] = useState<string | null>(null);
  const [fullDiff, setFullDiff] = useState(false);
  const [waiving, setWaiving] = useState<Id | null>(null);
  if (!review || !change) return null;
  const st = useDeck.getState;
  const delta = review.testDelta;

  return (
    <>
      <div className="dd-panel-head">
        <div className="dd-panel-kind">
          <span>Review</span>
          <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 450 }}>
            candidate {review.candidate}
          </span>
        </div>
        <h2 className="dd-panel-name" data-testid="review-title">
          {change.title}
        </h2>
        <div className="dd-panel-sub">
          Click a line to fly to it. Hold B to see the map before the change.
        </div>
      </div>
      <div className="dd-panel-body" data-testid="review-panel">
        {review.blockers.length ? (
          <div
            className="dd-note"
            style={{ borderColor: 'var(--contradicted)', color: 'var(--text)' }}
            data-testid="review-blockers"
          >
            <b>Accept is blocked</b>
            {review.blockers.map((b, i) => (
              <div key={i}>{b}</div>
            ))}
          </div>
        ) : null}

        <div className="dd-h">
          Checklist <small>{review.findings.length}</small>
        </div>
        {review.findings.map((f) => (
          <div key={f.id}>
            <button
              type="button"
              className="dd-check"
              data-testid="finding"
              data-kind={f.kind}
              onClick={() => flyToFinding(f)}
            >
              <span className="dd-badge" data-s={f.kind}>
                {LABEL[f.kind]}
              </span>
              <span className="dd-row-main">
                {f.text}
                {f.detail ? <span className="dd-row-sub">{f.detail}</span> : null}
              </span>
            </button>
            {f.kind === 'contradicted' && f.requirementId ? (
              waiving === f.id ? (
                <input
                  className="dd-input"
                  placeholder="Why is it acceptable to waive this? Press Enter to record it"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                      void st()
                        .patchPlan(change.id, {
                          waive: { requirementId: f.requirementId, note: e.currentTarget.value.trim() },
                        })
                        .then(() => st().enterReview(change.id));
                      setWaiving(null);
                    } else if (e.key === 'Escape') {
                      e.stopPropagation();
                      setWaiving(null);
                    }
                  }}
                  onBlur={() => setWaiving(null)}
                />
              ) : (
                <div style={{ display: 'flex', gap: 10, paddingLeft: 6 }}>
                  {f.check ? (
                    <button type="button" className="dd-add" onClick={() => setOpenCheck(f.check!)}>
                      Show the failing check
                    </button>
                  ) : null}
                  <button type="button" className="dd-add" onClick={() => setWaiving(f.id)}>
                    Waive with a note…
                  </button>
                </div>
              )
            ) : null}
          </div>
        ))}

        <div className="dd-h">
          Checks <small>run by the harness, not the agent</small>
        </div>
        {review.checks.map((c) => (
          <div key={c.name}>
            <button
              type="button"
              className="dd-check"
              data-testid="check"
              data-ok={c.exitCode === 0 && !c.skipped}
              onClick={() => setOpenCheck(openCheck === c.name ? null : c.name)}
            >
              <span
                className="dd-badge"
                data-s={c.skipped ? 'untested' : c.exitCode === 0 ? 'implemented' : 'contradicted'}
              >
                {c.skipped ? 'Skipped' : c.exitCode === 0 ? 'Passed' : 'Failed'}
              </span>
              <span className="dd-row-main">
                {c.name}
                <span className="dd-row-sub mono">
                  {c.skipped ?? `${c.command} · ${(c.durationMs / 1000).toFixed(1)}s`}
                </span>
              </span>
            </button>
            {openCheck === c.name ? <div className="dd-progress">{c.output || '(no output)'}</div> : null}
          </div>
        ))}

        {delta.added.length + delta.changed.length + delta.deleted.length ? (
          <>
            <div className="dd-h">Tests the agent touched</div>
            {(['added', 'changed', 'deleted'] as const).flatMap((kind) =>
              delta[kind].map((t) => (
                <div className="dd-row" key={`${kind}${t.id}`} data-testid="test-delta" data-kind={kind}>
                  <span className="dd-badge" data-s={kind === 'added' ? 'implemented' : 'requested'}>
                    {kind}
                  </span>
                  <span className="dd-row-main">{t.name}</span>
                </div>
              )),
            )}
          </>
        ) : null}

        <div className="dd-h">Code</div>
        <button
          type="button"
          className="dd-add"
          onClick={() => setFullDiff(!fullDiff)}
          data-testid="full-diff"
        >
          {fullDiff ? 'Hide' : 'Show'} the full diff ({review.diff.length} file
          {review.diff.length === 1 ? '' : 's'})
        </button>
        {fullDiff ? <DiffView files={review.diff} /> : null}
      </div>
    </>
  );
}

export function ReviewBanner() {
  const review = useDeck((s) => s.review);
  const showBefore = useDeck((s) => s.showBefore);
  const change = useDeck((s) => s.changes.find((c) => c.id === s.review?.changeId));
  const [revising, setRevising] = useState(false);
  if (!review || !change) return null;
  const st = useDeck.getState;
  if (showBefore) {
    return (
      <div className="dd-banner is-before" data-testid="review-banner">
        <Eye size={14} /> <b>Before the change</b>{' '}
        <span style={{ color: 'var(--muted)' }}>Release B to return to the candidate</span>
      </div>
    );
  }
  return (
    <div className="dd-banner" data-testid="review-banner">
      <span className="t">
        <b>Reviewing</b> {change.title}{' '}
        <span style={{ color: 'var(--muted)' }}>· candidate {review.candidate}</span>
      </span>
      {revising ? (
        <input
          className="dd-input"
          style={{ width: 280 }}
          placeholder="What should the next candidate do differently?"
          autoFocus
          data-testid="revise-input"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              void st().transition(change.id, 'revise', { comment: e.currentTarget.value.trim() });
              setRevising(false);
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              setRevising(false);
            }
          }}
        />
      ) : (
        <>
          <button
            type="button"
            className="dd-btn is-primary"
            disabled={!review.canAccept}
            title={review.canAccept ? 'Merge this candidate' : review.blockers.join('\n')}
            data-testid="accept"
            onClick={() => void st().transition(change.id, 'accept')}
          >
            <Check size={14} /> Accept
          </button>
          <button type="button" className="dd-btn" data-testid="revise" onClick={() => setRevising(true)}>
            <RotateCcw size={13} /> Revise
          </button>
          <button
            type="button"
            className="dd-btn is-danger"
            data-testid="reject"
            onClick={() => void st().transition(change.id, 'reject')}
          >
            Reject
          </button>
        </>
      )}
      <button
        type="button"
        className="dd-icon-btn"
        aria-label="Leave review"
        title="Leave review without deciding"
        onClick={() => st().exitReview()}
      >
        <X size={14} />
      </button>
    </div>
  );
}
