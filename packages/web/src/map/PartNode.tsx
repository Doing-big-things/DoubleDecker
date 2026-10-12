// A part: one large card of the simple view (spec §3.13). It stands for a top-level area and
// says what that area is for in a few plain lines, with one place to ask for something new.
import { type Id, type TestStats, testStats } from '@decker/deck-model';
import type { NodeProps } from '@xyflow/react';
import { ChevronRight, Plus } from 'lucide-react';
import { memo, useMemo } from 'react';
import { fitPart } from '../model/simple';
import { currentRun, type PartWork, useDeck } from '../state/store';
import { areaStyle } from './AreaNode';
import { Ports, StateBadge, TestsChip } from './BlockNode';
import { ZOOM_STEPS } from './camera';

export type PartLod = 'full' | 'scaled' | 'name';

const FULL_FROM = 0.76;
const NAME_BELOW = 0.44;

/**
 * Full cards from 76% zoom. From there down to 44% the text is drawn just large enough to
 * stay readable, and a card shows as much of itself as still fits. Below that, the name alone.
 */
export function partLod(step: number): PartLod {
  const zoom = step / ZOOM_STEPS;
  return zoom >= FULL_FROM ? 'full' : zoom >= NAME_BELOW ? 'scaled' : 'name';
}

/** How much larger than designed a card's text is drawn at a zoom step, so it never falls under 11 px. */
export function partScale(step: number): number {
  const zoom = Math.max(0.04, step / ZOOM_STEPS);
  return zoom >= FULL_FROM ? 1 : (FULL_FROM + 0.012) / zoom;
}

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

const WORK: Record<PartWork['kind'], { text: (n: number) => string; s: string }> = {
  requested: { text: (n) => `${n} request${n === 1 ? '' : 's'} not sent`, s: 'requested' },
  building: { text: () => 'Being built', s: 'implemented' },
  needs_you: { text: () => 'Waiting for you', s: 'requested' },
  review: { text: () => 'Ready to review', s: 'implemented' },
  failed: { text: () => 'Did not work', s: 'contradicted' },
};

function WorkFlag({ work }: { work: PartWork }) {
  const look = WORK[work.kind];
  return (
    <button
      type="button"
      className="dd-badge dd-part-work nodrag nopan"
      data-s={look.s}
      data-work={work.kind}
      data-testid="part-work"
      title="Open the change"
      onClick={(e) => {
        e.stopPropagation();
        const st = useDeck.getState();
        if (work.kind === 'review') void st.enterReview(work.changeId);
        else st.set({ trayOpen: true, activeChangeId: work.changeId });
      }}
      onDoubleClick={stop}
    >
      {work.kind === 'building' ? <span className="dd-spin" /> : null}
      {look.text(work.count)}
    </button>
  );
}

function Ask({ id, name }: { id: Id; name: string }) {
  const asking = useDeck((s) => s.asking === id);
  const st = useDeck.getState;
  const send = (value: string) => {
    if (st().asking !== id) return;
    if (value.trim()) st().addBullet(id, value);
    st().set({ asking: null });
  };
  if (!asking) {
    return (
      <button
        type="button"
        className="dd-ask nodrag nopan"
        data-testid="part-ask"
        title={`Ask for something new in ${name}  (N)`}
        onClick={(e) => {
          e.stopPropagation();
          st().set({ asking: id });
        }}
        onDoubleClick={stop}
      >
        <Plus size={14} /> <span>Ask for something new</span>
      </button>
    );
  }
  return (
    <input
      className="dd-ask-input nodrag nopan"
      placeholder="Say what it should do, in your own words"
      aria-label={`Ask for something new in ${name}`}
      maxLength={400}
      autoFocus
      data-testid="part-ask-input"
      onClick={stop}
      onDoubleClick={stop}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') send(e.currentTarget.value);
        else if (e.key === 'Escape') st().set({ asking: null });
      }}
      onBlur={(e) => send(e.currentTarget.value)}
    />
  );
}

export const PartNode = memo(function PartNode({ id, width, height }: NodeProps) {
  const part = useDeck((s) => s.simple?.partById.get(id));
  const plan = useDeck((s) => s.simplePlans.get(id));
  const index = useDeck((s) => s.index);
  const selected = useDeck((s) => s.selectedId === id);
  const dim = useDeck((s) => s.lit !== null && !s.lit.has(id));
  const finding = useDeck((s) => s.simpleState.get(id));
  const isRequest = useDeck((s) => s.marks.get(id)?.state === 'requested');
  const unchanged = useDeck((s) => s.simpleChanged !== null && !s.simpleChanged.has(id));
  const inReview = useDeck((s) => s.review !== null);
  const changedInReview = useDeck(
    (s) => s.review !== null && !s.showBefore && (s.simpleChanged?.has(id) ?? false),
  );
  const work = useDeck((s) => s.simpleWork.get(id));
  const step = useDeck((s) => s.zoomStep);
  const asking = useDeck((s) => s.asking === id);
  const run = useDeck(currentRun);
  const marks = useDeck((s) => s.marks);
  const findings = useDeck((s) => s.findings);

  const stats: TestStats | null = useMemo(() => {
    if (!index || !part) return null;
    const tests = new Set(part.blocks.flatMap((b) => index.testsOf.get(b) ?? []));
    return testStats([...tests], run);
  }, [index, part, run]);

  const lod = partLod(step);
  const scale = partScale(step);
  // Zoomed out, the card keeps its size and its text grows: fewer lines fit, and those are shown.
  const shown = useMemo(
    () => (part && plan && lod === 'scaled' && !plan.bar ? fitPart(part, plan, scale) : plan),
    [part, plan, lod, scale],
  );

  if (!index || !part || !plan || !shown) return null;
  const hue = part.node.kind === 'area' ? areaStyle(index, id).hue : 226;
  const state = finding ?? (isRequest ? 'requested' : undefined);
  const w = width ?? 0;
  const h = height ?? plan.height;
  const cls = [
    'dd-part',
    selected ? 'is-selected' : '',
    part.common ? 'is-common' : '',
    plan.bar ? 'is-bar' : '',
    state === 'requested' || state === 'missing' ? 'is-requested' : '',
    dim ? 'dd-dim' : '',
    unchanged ? 'dd-unchanged' : '',
  ].join(' ');
  const flag =
    inReview && state ? (
      <StateBadge state={state} />
    ) : state === 'requested' ? (
      <StateBadge state="requested" />
    ) : work && !inReview ? (
      <WorkFlag work={work} />
    ) : changedInReview ? (
      <span className="dd-badge" data-s="implemented" data-testid="badge-changed">
        Changed
      </span>
    ) : null;
  const common = {
    role: 'group',
    className: cls,
    style: { '--h': hue, '--ps': scale } as React.CSSProperties,
    'data-testid': 'part',
    'data-id': id,
    'data-name': part.name,
    'data-state': state ?? '',
    'data-lod': lod,
    'aria-label': `${part.name}${part.summary ? `: ${part.summary.text}` : ''}${state ? `, ${state}` : ''}`,
  };

  if (lod === 'name') {
    const lower = Math.max(0.04, step / ZOOM_STEPS);
    const fit = Math.min((w * 0.86) / (part.name.length * 0.6 + 1), (h - 12) / 1.25);
    return (
      <div {...common}>
        <div className="dd-part-far dd-lod">
          <b style={{ fontSize: Math.max(11 / lower, Math.min(17 / lower, fit)) }} data-testid="part-name">
            {part.name}
          </b>
        </div>
        {flag ? <div className="dd-part-flag">{flag}</div> : null}
      </div>
    );
  }

  const full = lod === 'full';
  const open =
    full && part.blocks.length > 0 && !isRequest ? (
      <button
        type="button"
        className="dd-part-open nodrag nopan"
        data-testid="part-open"
        title={`See inside ${part.name}: the advanced view  (Enter)`}
        onClick={(e) => {
          e.stopPropagation();
          useDeck.getState().setView('advanced', { focus: id });
        }}
        onDoubleClick={stop}
      >
        Open <ChevronRight size={13} />
      </button>
    ) : null;
  const meta = (
    <span className="dd-part-meta" data-testid="part-meta">
      {plan.blocks > 0 ? `${plan.blocks} block${plan.blocks === 1 ? '' : 's'}` : 'new'}
    </span>
  );
  // The tests chip sits in the title row, where a block's card has it in the advanced view.
  const tests =
    full && stats && stats.total > 0 ? (
      <span className="dd-part-tests">
        <TestsChip stats={stats} />
      </span>
    ) : null;

  if (plan.bar) {
    return (
      <div {...common}>
        <div className="dd-part-bar dd-lod">
          <span className="dd-part-name" data-testid="part-name">
            {part.name}
          </span>
          {asking ? null : (
            <span className="dd-part-bar-sum" title={part.summary?.text} data-testid="part-summary">
              {part.summary?.text}
            </span>
          )}
          {full && !asking ? (
            <span className="dd-part-bar-used" data-testid="part-used-by">
              {plan.usedBy}
            </span>
          ) : null}
          {full ? <Ask id={id} name={part.name} /> : null}
          {full && !asking ? meta : null}
          {asking ? null : tests}
          {asking ? null : open}
        </div>
        {flag ? <div className="dd-part-flag">{flag}</div> : null}
        {full ? <Ports title="Drag to another part to ask for a connection" /> : null}
      </div>
    );
  }

  return (
    <div {...common}>
      <div className="dd-part-body dd-lod">
        <div className="dd-part-title">
          <span className="dd-part-name" data-testid="part-name">
            {part.name}
          </span>
          <span className="dd-spacer" />
          {open}
          {tests}
        </div>
        {part.summary && shown.summaryLines > 0 ? (
          <div
            className="dd-part-summary"
            style={{ WebkitLineClamp: shown.summaryLines }}
            title={part.summary.text}
            data-testid="part-summary"
          >
            {part.summary.text}
          </div>
        ) : null}
        {shown.rows.length ? (
          <div className="dd-part-rows">
            {shown.rows.map((row) => {
              const rowState = findings.get(row.line.id) ?? marks.get(row.line.id)?.state;
              const pending = rowState === 'requested' || rowState === 'missing';
              return (
                <div
                  key={row.line.id}
                  className={`dd-part-row${pending ? ' is-requested' : ''}${row.kind === 'asked' ? ' is-asked' : ''}`}
                  data-testid="part-row"
                  data-state={pending ? 'requested' : ''}
                  title={pending ? `${row.line.text}  (requested, not built yet)` : row.line.text}
                >
                  <i aria-hidden="true" />
                  <span style={{ WebkitLineClamp: row.lines }}>{row.line.text}</span>
                </div>
              );
            })}
            {shown.more > 0 ? <div className="dd-part-more">+{shown.more} more</div> : null}
          </div>
        ) : null}
        {full ? (
          <div className="dd-part-foot">
            <Ask id={id} name={part.name} />
            {asking ? null : meta}
          </div>
        ) : null}
      </div>
      {flag ? <div className="dd-part-flag">{flag}</div> : null}
      {full ? <Ports title="Drag to another part to ask for a connection" /> : null}
    </div>
  );
});
