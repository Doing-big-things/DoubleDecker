// The change tray (spec §3.8, §6.1): pending operations, then the lifecycle of each change.
import {
  buildIndex,
  type Change,
  type ChangeOp,
  describeOp,
  type Id,
  type Plan,
  renderDeckText,
  withNotes,
} from '@decker/deck-model';
import { FileText, Send, Trash2, Undo2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { camera } from '../map/camera';
import { isBusy, isOpen, useDeck } from '../state/store';

const STATE_LABEL: Record<Change['state'], string> = {
  draft: 'Draft',
  planning: 'Planning',
  needs_answer: 'Needs your answer',
  plan_ready: 'Plan ready',
  implementing: 'Implementing',
  checking: 'Checking',
  in_review: 'In review',
  accepted: 'Accepted',
  rejected: 'Rejected',
  failed: 'Failed',
};

const OP_GLYPH: Record<ChangeOp['type'], string> = {
  set_behavior: '✎',
  add_behavior: '+',
  add_edge: '→',
  add_block: '▢',
  rename: 'Aa',
  remove: '−',
};

function targetOf(op: ChangeOp): Id[] {
  switch (op.type) {
    case 'add_edge':
      return [op.from, op.to];
    case 'add_block':
      return [op.id];
    default:
      return [op.targetId];
  }
}

function PlanView({ change, plan }: { change: Change; plan: Plan }) {
  const [reqs, setReqs] = useState(plan.requirements);
  const [answers, setAnswers] = useState<Record<Id, string>>(
    Object.fromEntries(plan.questions.map((q) => [q.id, q.answer ?? ''])),
  );
  const editable = change.state === 'plan_ready' || change.state === 'needs_answer';
  const unanswered = plan.questions.some((q) => !answers[q.id]?.trim());
  const st = useDeck.getState;
  return (
    <div data-testid="plan">
      <div className="dd-h">Plan</div>
      <p style={{ margin: '0 0 6px', fontSize: 12.5 }}>{plan.interpretation}</p>
      <div className="dd-h">
        Requirements <small>each one a testable statement</small>
      </div>
      {reqs.map((r, i) => (
        <div className="dd-row" key={r.id} data-testid="requirement">
          <span style={{ color: 'var(--faint)', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
          <span className="dd-row-main">
            {editable ? (
              <input
                className="dd-input"
                value={r.text}
                onChange={(e) =>
                  setReqs(reqs.map((x) => (x.id === r.id ? { ...x, text: e.target.value } : x)))
                }
              />
            ) : (
              r.text
            )}
            {r.test ? (
              <span className="dd-row-sub">checked by the test “{r.test}”</span>
            ) : (
              <span className="dd-row-sub">no test proposed</span>
            )}
          </span>
        </div>
      ))}
      {plan.questions.length ? <div className="dd-h">Questions</div> : null}
      {plan.questions.map((q) => (
        <div key={q.id} style={{ marginBottom: 8 }} data-testid="question">
          <div style={{ fontSize: 12.5, marginBottom: 4 }}>{q.text}</div>
          {editable ? (
            <>
              {q.options?.length ? (
                <div className="dd-seg" style={{ marginBottom: 4 }}>
                  {q.options.map((o) => (
                    <button
                      type="button"
                      key={o}
                      aria-pressed={answers[q.id] === o}
                      onClick={() => setAnswers({ ...answers, [q.id]: o })}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              ) : null}
              <input
                className="dd-input"
                placeholder="Your answer"
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
              />
            </>
          ) : (
            <div className="dd-row-sub">{q.answer || 'not answered'}</div>
          )}
        </div>
      ))}
      {plan.limits.length ? (
        <>
          <div className="dd-h">Accepted limits</div>
          {plan.limits.map((l) => (
            <div className="dd-row" key={l}>
              <span className="dd-row-main" style={{ color: 'var(--muted)' }}>
                {l}
              </span>
            </div>
          ))}
        </>
      ) : null}
      {plan.files.length ? (
        <>
          <div className="dd-h">Expected to touch</div>
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            {plan.files.join('\n')}
          </div>
        </>
      ) : null}
      {editable ? (
        <div className="dd-popover-foot">
          <button
            type="button"
            className="dd-btn is-primary"
            disabled={unanswered}
            title={
              unanswered
                ? 'Answer every question first'
                : 'Approve this plan. It becomes the agreed contract.'
            }
            data-testid="approve"
            onClick={() =>
              void st()
                .patchPlan(change.id, { requirements: reqs, answers })
                .then(() => st().transition(change.id, 'approve'))
            }
          >
            Approve plan
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ChangeCard({ change }: { change: Change }) {
  const index = useDeck((s) => s.index);
  const bundle = useDeck((s) => s.bundle);
  const progress = useDeck((s) => s.progress[change.id]);
  const mode = useDeck((s) => s.source?.mode);
  const caps = useDeck((s) => s.bundle?.capabilities);
  const [asText, setAsText] = useState(false);
  const st = useDeck.getState;
  const text = useMemo(() => {
    if (!asText || !bundle) return '';
    const base = buildIndex(withNotes(bundle.snapshot, bundle.notes));
    return renderDeckText(base, {
      focus: change.operations.flatMap(targetOf),
      operations: change.operations,
    });
  }, [asText, bundle, change.operations]);
  if (!index) return null;
  const draft = change.state === 'draft';
  const candidate = change.candidates.at(-1);
  const canSubmit = mode === 'server' && caps?.worker !== 'none';

  return (
    <section data-testid="change" data-state={change.state} style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        {draft ? (
          <input
            className="dd-input"
            style={{ fontWeight: 600 }}
            value={change.title}
            onChange={(e) => st().setDraftTitle(e.target.value)}
            aria-label="Change title"
            data-testid="change-title"
          />
        ) : (
          <b style={{ flex: 1, minWidth: 0, fontSize: 13 }}>{change.title}</b>
        )}
        <span className="dd-state" data-s={change.state} data-testid="change-state">
          {isBusy(change) ? <span className="dd-spin" /> : null}
          {STATE_LABEL[change.state]}
        </span>
      </div>

      <ul className="dd-oplist">
        {change.operations.map((op) => (
          <li key={op.id} data-testid="op" data-type={op.type}>
            <span className="mono" style={{ width: 16, textAlign: 'center', color: 'var(--requested)' }}>
              {OP_GLYPH[op.type]}
            </span>
            <button
              type="button"
              className="t"
              title="Show on the map"
              onClick={() => camera.flyTo(targetOf(op).map((id) => index.blockOf.get(id) ?? id))}
            >
              {describeOp(index, op, change.operations)}
              {op.type === 'add_edge' || op.type === 'add_block'
                ? op.bullets.map((b, i) => (
                    <span className="dd-row-sub" key={i}>
                      ▪ {b}
                    </span>
                  ))
                : null}
            </button>
            {draft ? (
              <button
                type="button"
                className="dd-mini"
                aria-label="Remove this operation"
                onClick={() => st().removeOp(op.id)}
              >
                <X size={12} />
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {asText ? (
        <pre className="dd-progress" style={{ maxHeight: 260 }} data-testid="deck-text">
          {text}
        </pre>
      ) : null}
      {change.plan && !draft ? (
        <PlanView change={change} plan={change.plan} key={`${change.id}:${change.state}`} />
      ) : null}
      {progress?.length && isBusy(change) ? (
        <div className="dd-progress" data-testid="progress">
          {progress.slice(-30).join('\n')}
        </div>
      ) : null}
      {change.error ? (
        <div className="dd-note" style={{ borderColor: 'var(--contradicted)' }}>
          {change.error}
        </div>
      ) : null}
      {candidate && !draft ? (
        <div className="dd-row-sub" style={{ marginTop: 6 }}>
          Candidate {candidate.n} on <span className="mono">{candidate.branch}</span>
          {candidate.comment ? ` · revised: “${candidate.comment}”` : ''}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`dd-btn${asText ? ' is-on' : ''}`}
          onClick={() => setAsText(!asText)}
          data-testid="as-text"
          title="The change as the task description an agent receives"
        >
          <FileText size={13} /> As a task
        </button>
        {draft ? (
          <>
            <button
              type="button"
              className="dd-btn is-primary"
              disabled={!canSubmit}
              title={
                canSubmit
                  ? 'Send this change to a planning agent'
                  : mode === 'server'
                    ? 'No agent worker is configured'
                    : 'This map is a fixture. Run "decker <path-to-repo>" to send changes to an agent.'
              }
              data-testid="submit"
              onClick={() => void st().transition(change.id, 'submit')}
            >
              <Send size={13} /> Submit
            </button>
            <button
              type="button"
              className="dd-btn is-ghost"
              onClick={() => void st().discardChange(change.id)}
              data-testid="discard"
            >
              <Trash2 size={13} /> Discard
            </button>
          </>
        ) : null}
        {change.state === 'in_review' ? (
          <button
            type="button"
            className="dd-btn is-primary"
            data-testid="open-review"
            onClick={() => void st().enterReview(change.id)}
          >
            Review candidate {candidate?.n}
          </button>
        ) : null}
        {change.state === 'failed' ? (
          <>
            <button
              type="button"
              className="dd-btn"
              data-testid="retry"
              onClick={() => void st().transition(change.id, 'retry')}
            >
              Try again
            </button>
            <button
              type="button"
              className="dd-btn is-ghost"
              onClick={() => void st().transition(change.id, 'reject')}
            >
              Reject
            </button>
          </>
        ) : null}
        {change.state === 'accepted' && !change.reverts ? (
          <button
            type="button"
            className="dd-btn is-ghost"
            data-testid="revert"
            title="Create a candidate that undoes this change, for review"
            onClick={() => void st().transition(change.id, 'revert')}
          >
            <Undo2 size={13} /> Revert
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function ChangeTray() {
  const open = useDeck((s) => s.trayOpen);
  const changes = useDeck((s) => s.changes);
  const canUndo = useDeck((s) => s.undoStack.length > 0);
  if (!open) return null;
  const st = useDeck.getState;
  const active = changes.filter(isOpen);
  const done = changes
    .filter((c) => !isOpen(c))
    .slice(-4)
    .reverse();
  return (
    <div className="dd-tray" data-testid="tray" role="dialog" aria-label="Changes">
      <div className="dd-tray-head">
        <b style={{ flex: 1 }}>Changes</b>
        <button
          type="button"
          className="dd-btn is-ghost"
          disabled={!canUndo}
          onClick={() => st().undo()}
          title="Undo  (Ctrl+Z)"
          data-testid="undo"
        >
          <Undo2 size={13} /> Undo
        </button>
        <button
          type="button"
          className="dd-icon-btn"
          aria-label="Close"
          onClick={() => st().set({ trayOpen: false })}
        >
          <X size={15} />
        </button>
      </div>
      <div className="dd-tray-body">
        {active.length === 0 && done.length === 0 ? (
          <div className="dd-empty">
            Nothing pending. Edit the map to request a change: click a bullet and type, drag from one block to
            another, or press N for a new block.
          </div>
        ) : null}
        {active.map((c) => (
          <ChangeCard key={c.id} change={c} />
        ))}
        {done.length ? <div className="dd-h">Finished</div> : null}
        {done.map((c) => (
          <ChangeCard key={c.id} change={c} />
        ))}
      </div>
    </div>
  );
}
