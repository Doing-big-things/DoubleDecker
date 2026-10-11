import {
  type Bullet,
  type CardBullet,
  cardBullets,
  chipLabel,
  type DeckIndex,
  type DeckNode,
  type Id,
  shortSignature,
  type TestRun,
  type TestStats,
  testStats,
} from '@decker/deck-model';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { memo, useMemo } from 'react';
import { reviewFlags } from '../lib/review';
import { type DrawerRow, drawerRows, expandedPlan, fitBullets, opOffsets } from '../model/measure';
import { currentRun, testsOpen, useDeck, useLevel, visualState } from '../state/store';
import { BANDS, textScale } from './camera';

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

export function Caret() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M4.5 2.5 8 6l-3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4 6.2 8 10l4-3.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const GLYPH: Record<string, string> = { passed: '✓', failed: '✕', skipped: '–', none: '·' };

export function TestsChip(props: {
  stats: TestStats;
  open?: boolean;
  onClick?: () => void;
  flag?: string;
  label?: string;
}) {
  const { stats, open, onClick, flag } = props;
  return (
    <button
      type="button"
      className={`dd-chip nodrag${open ? ' is-open' : ''}`}
      data-s={stats.state}
      data-testid="tests-chip"
      aria-expanded={open}
      aria-label={props.label ?? testsLabel(stats)}
      title={testsLabel(stats)}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      onDoubleClick={stop}
    >
      {onClick ? <Caret /> : null}
      {chipLabel(stats)}
      {flag ? <span className="dd-chip-flag">{flag}</span> : null}
    </button>
  );
}

export function testsLabel(s: TestStats): string {
  if (s.total === 0) return 'No tests call this directly';
  const parts = [`${s.total} test${s.total === 1 ? '' : 's'} call this directly`];
  if (s.state === 'notrun') parts.push('not run at this commit');
  else {
    if (s.passed) parts.push(`${s.passed} passed`);
    if (s.failed) parts.push(`${s.failed} failing`);
    if (s.skipped) parts.push(`${s.skipped} skipped`);
    if (s.notRun) parts.push(`${s.notRun} not run`);
  }
  return parts.join(' · ');
}

export function Mark({ origin }: { origin: Bullet['origin'] }) {
  return <span className="dd-mark" data-o={origin} aria-hidden="true" />;
}

function BulletRow(props: { item: CardBullet; blockId: Id; selected: boolean; chip?: React.ReactNode }) {
  const { item, selected } = props;
  const state = useDeck((s) => visualState(s, item.bullet.id));
  const editing = useDeck((s) => s.editing === item.bullet.id);
  const before = useDeck((s) => s.marks.get(item.bullet.id)?.before);
  const cls =
    state === 'requested' || state === 'missing'
      ? ' is-requested'
      : state === 'changed'
        ? ' is-changed'
        : state === 'removed'
          ? ' is-removed'
          : '';
  return (
    <div
      className={`dd-bullet${cls}`}
      title={before ? `${item.bullet.text}  (was: ${before})` : item.bullet.text}
    >
      <Mark origin={item.bullet.origin} />
      {editing ? (
        <input
          className="dd-inline-edit nodrag nopan"
          defaultValue={item.bullet.text}
          autoFocus
          onClick={stop}
          onDoubleClick={stop}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              useDeck.getState().setBullet(item.ownerId, item.bullet, e.currentTarget.value);
              useDeck.getState().set({ editing: null });
            } else if (e.key === 'Escape') useDeck.getState().set({ editing: null });
          }}
          onBlur={(e) => {
            if (useDeck.getState().editing !== item.bullet.id) return;
            useDeck.getState().setBullet(item.ownerId, item.bullet, e.currentTarget.value);
            useDeck.getState().set({ editing: null });
          }}
        />
      ) : (
        <span
          className="dd-bullet-text"
          onClick={(e) => {
            if (!selected) return;
            e.stopPropagation();
            useDeck.getState().set({ editing: item.bullet.id });
          }}
        >
          {item.bullet.text}
        </span>
      )}
      {props.chip}
    </div>
  );
}

function Drawer({ rows, run, blockId }: { rows: DrawerRow[]; run: TestRun | null; blockId: Id }) {
  return (
    <div className="dd-drawer nodrag" data-testid="tests-drawer" onDoubleClick={stop}>
      {rows.map((row, i) => {
        if (row.t === 'group') {
          return (
            <div className="dd-drawer-group" key={`g${row.id}`}>
              <span>{row.label}</span>
              <TestsChip stats={testStats(row.tests, run)} />
            </div>
          );
        }
        if (row.t === 'more') {
          return (
            <div className="dd-more" key={`m${i}`}>
              +{row.n} more{row.what === 'operations' ? ' operations' : ''}
            </div>
          );
        }
        const status = run?.results[row.test.id] ?? 'none';
        return (
          <button
            type="button"
            className="dd-test"
            key={row.test.id}
            title={row.test.name}
            onClick={(e) => {
              e.stopPropagation();
              const st = useDeck.getState();
              st.select(blockId, { keepTab: true });
              st.openPeek({
                path: row.test.source.path,
                startLine: row.test.source.startLine,
                endLine: row.test.source.endLine,
                title: row.test.name,
              });
            }}
          >
            <span className="dd-glyph" data-s={status}>
              {GLYPH[status]}
            </span>
            <span>{row.test.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function OpRow({
  op,
  index,
  run,
  blockId,
  selected,
}: {
  op: DeckNode;
  index: DeckIndex;
  run: TestRun | null;
  blockId: Id;
  selected: boolean;
}) {
  const focus = useDeck((s) => s.focusOpId === op.id);
  const state = useDeck((s) => visualState(s, op.id));
  const best = useMemo(() => {
    const rank = (b: Bullet) =>
      b.origin === 'authored'
        ? 0
        : b.origin === 'declared' && b.basis !== 'name'
          ? 1
          : b.origin === 'summarized'
            ? 2
            : 3;
    return [...op.bullets].sort((a, b) => rank(a) - rank(b))[0];
  }, [op]);
  const tests = index.testsOf.get(op.id) ?? [];
  const sig = op.signature ? shortSignature(op.signature) : `${op.name}()`;
  const paren = sig.indexOf('(');
  return (
    <div
      className={`dd-op nodrag${focus ? ' is-focus' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        useDeck.getState().select(blockId, { op: op.id, keepTab: true });
      }}
    >
      {best ? (
        <BulletRow
          item={{ bullet: best, ownerId: op.id, opId: op.id }}
          blockId={blockId}
          selected={selected && focus}
          chip={
            <TestsChip
              stats={testStats(tests, run)}
              onClick={tests.length ? () => useDeck.getState().toggleTests(blockId) : undefined}
            />
          }
        />
      ) : null}
      <div className="dd-sig" title={op.signature}>
        {state === 'renamed' ? <s>{useDeck.getState().marks.get(op.id)?.before} </s> : null}
        <b>{paren > 0 ? sig.slice(0, paren) : sig}</b>
        {paren > 0 ? sig.slice(paren) : ''}
        {op.tags?.includes('api') ? ' · API' : ''}
      </div>
    </div>
  );
}

function Arcs({ index, id, showInternals }: { index: DeckIndex; id: Id; showInternals: boolean }) {
  const offsets = useMemo(() => opOffsets(index, id, showInternals), [index, id, showInternals]);
  const edges = index.internals.get(id) ?? [];
  return (
    <svg className="dd-arcs" aria-hidden="true">
      {edges.map((e, i) => {
        const y1 = offsets.get(e.from);
        const y2 = offsets.get(e.to);
        if (y1 === undefined || y2 === undefined) return null;
        const x = 11 - (6 + (i % 3) * 2);
        return (
          <path
            key={e.id}
            d={`M11,${y1}C${x},${y1} ${x},${y2} 10,${y2}M6.5,${y2 - 3.5}L10.5,${y2}L6.5,${y2 + 3.5}`}
          />
        );
      })}
    </svg>
  );
}

const STATE_LABEL: Record<string, string> = {
  requested: 'Requested',
  missing: 'Missing',
  implemented: 'Implemented',
  contradicted: 'Contradicted',
  unrequested: 'Unrequested',
  supported: 'Supported by a test',
  untested: 'Not tested',
  removed: 'Remove requested',
};

export function StateBadge({ state }: { state: string | undefined }) {
  if (!state || !STATE_LABEL[state] || state === 'removed') return null;
  return (
    <span className="dd-badge" data-s={state} data-testid={`badge-${state}`}>
      {state === 'implemented' || state === 'supported' ? '✓ ' : ''}
      {STATE_LABEL[state]}
    </span>
  );
}

function Ports() {
  return (
    <>
      <Handle type="source" id="cs" position={Position.Bottom} className="dd-anchor" isConnectable={false} />
      <Handle type="target" id="ct" position={Position.Top} className="dd-anchor" isConnectable={false} />
      <Handle type="target" id="in" position={Position.Top} className="dd-handle-in" />
      <Handle
        type="source"
        id="pt"
        position={Position.Top}
        className="dd-port"
        title="Drag to another block to request an arrow"
      />
      <Handle
        type="source"
        id="pb"
        position={Position.Bottom}
        className="dd-port"
        title="Drag to another block to request an arrow"
      />
      <Handle
        type="source"
        id="pl"
        position={Position.Left}
        className="dd-port"
        title="Drag to another block to request an arrow"
      />
      <Handle
        type="source"
        id="pr"
        position={Position.Right}
        className="dd-port"
        title="Drag to another block to request an arrow"
      />
    </>
  );
}

export const BlockNode = memo(function BlockNode({ id, height }: NodeProps) {
  const level = useLevel();
  const index = useDeck((s) => s.index);
  const selected = useDeck((s) => s.selectedId === id);
  const dim = useDeck((s) => s.lit !== null && !s.lit.has(id));
  const expanded = useDeck((s) => s.expanded.has(id));
  const showInternals = useDeck((s) => s.internals.has(id));
  const drawerOpen = useDeck((s) => testsOpen(s, id));
  const allTests = useDeck((s) => s.allTests);
  const run = useDeck(currentRun);
  const state = useDeck((s) => visualState(s, id));
  const unchanged = useDeck((s) => s.changedIds !== null && !s.changedIds.has(id));
  const renamedFrom = useDeck((s) =>
    s.marks.get(id)?.state === 'renamed' ? s.marks.get(id)?.before : undefined,
  );
  const baseline = useDeck((s) => !s.review && (s.bundle?.changedSinceBaseline.includes(id) ?? false));
  const flag = useDeck((s) =>
    s.review && !s.showBefore && s.index ? reviewFlags(s.review, s.index).get(id) : undefined,
  );
  const band = useDeck((s) => (level === 'blocks' ? s.band : level === 'architecture' ? s.band : 0));
  const editingName = useDeck((s) => s.editing === `name:${id}`);

  const block = index?.byId.get(id);
  const tests = index?.testsOf.get(id) ?? [];
  const stats = useMemo(() => testStats(tests, run), [tests, run]);
  const bullets = useMemo(() => (index ? cardBullets(index, id) : []), [index, id]);

  if (!index || !block) return null;

  const cls = [
    'dd-block',
    selected ? 'is-selected' : '',
    dim ? 'dd-dim' : '',
    unchanged ? 'dd-unchanged' : '',
    state === 'requested' || state === 'missing' ? 'is-requested' : '',
    state === 'removed' ? 'is-removed' : '',
  ].join(' ');
  const aria = `${block.name}, block${state ? `, ${STATE_LABEL[state] ?? state}` : ''}, ${bullets.length} bullets`;

  if (level !== 'blocks') {
    const fs = 11.5 / BANDS[band]!;
    const lines = Math.max(1, Math.floor(((height ?? 100) - 22) / (fs * 1.16)));
    return (
      <div
        role="group"
        className={`${cls} is-arch`}
        data-coverage={block.coverage}
        data-testid="block"
        data-id={id}
        data-name={block.name}
        aria-label={aria}
      >
        <div className="dd-block-clip">
          <div className="dd-arch-name dd-lod" style={{ WebkitLineClamp: lines }}>
            {block.name.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[_./-])/).map((part, i) => (
              <span key={i}>
                {i > 0 ? <wbr /> : null}
                {part}
              </span>
            ))}
          </div>
          {allTests ? (
            <div className="dd-arch-chip" data-s={stats.state}>
              {chipLabel(stats)}
            </div>
          ) : stats.failed > 0 ? (
            <div className="dd-arch-mark" title={testsLabel(stats)} data-testid="arch-fail">
              ✕
            </div>
          ) : null}
        </div>
        {state && state !== 'removed' && state !== 'renamed' ? (
          <div className="dd-block-flag">
            <StateBadge state={state} />
          </div>
        ) : null}
        <Ports />
      </div>
    );
  }

  const ts = textScale(band);
  const gaps = index.gapsOf.get(id)?.length ?? 0;
  const plan = expanded ? expandedPlan(index, id, showInternals) : null;
  const fit = expanded ? null : fitBullets(index, id, ts, bullets);
  const rows = drawerOpen ? drawerRows(index, id, run) : [];
  const clipped = ts > 1.001 && (expanded || rows.length > 0);

  return (
    <div
      role="group"
      className={cls}
      data-coverage={block.coverage}
      data-testid="block"
      data-id={id}
      data-name={block.name}
      data-state={state ?? ''}
      aria-label={aria}
    >
      <div className="dd-block-clip">
        <div className="dd-lod">
          <div className="dd-block-title">
            {baseline ? <span className="dd-baseline" title="Changed since the accepted baseline" /> : null}
            {editingName ? (
              <input
                className="dd-inline-edit dd-block-name nodrag nopan"
                defaultValue={block.name}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                onClick={stop}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    useDeck.getState().requestRename(id, e.currentTarget.value);
                    useDeck.getState().set({ editing: null });
                  } else if (e.key === 'Escape') useDeck.getState().set({ editing: null });
                }}
                onBlur={() => useDeck.getState().set({ editing: null })}
              />
            ) : (
              <span className="dd-block-name">
                {renamedFrom ? <s>{renamedFrom}</s> : null}
                {block.name}
              </span>
            )}
            {block.tags?.includes('entry') ? <span className="dd-tag">entry</span> : null}
            {block.tags?.includes('stub') ? <span className="dd-tag">stub</span> : null}
            <span className="dd-spacer" />
            {gaps > 0 ? (
              <span
                className="dd-opaque"
                title={`${gaps} construct${gaps === 1 ? '' : 's'} the extractor could not follow`}
                data-testid="opaque"
              >
                {gaps}
              </span>
            ) : null}
            <TestsChip
              stats={stats}
              open={drawerOpen}
              flag={flag}
              onClick={() => useDeck.getState().toggleTests(id)}
            />
            <button
              type="button"
              className={`dd-chev nodrag${expanded ? ' is-open' : ''}`}
              aria-label={expanded ? 'Collapse' : 'Expand'}
              aria-expanded={expanded}
              data-testid="expand"
              onClick={(e) => {
                e.stopPropagation();
                useDeck.getState().toggleExpand(id);
              }}
              onDoubleClick={stop}
            >
              <Chevron />
            </button>
          </div>
          {block.summary && (fit?.summary ?? true) ? (
            <div className="dd-summary">{block.summary.text}</div>
          ) : null}

          {fit ? (
            bullets.length > 0 && fit.shown + fit.more > 0 ? (
              <div className="dd-bullets">
                {bullets.slice(0, fit.shown).map((b) => (
                  <BulletRow key={b.bullet.id} item={b} blockId={id} selected={selected} />
                ))}
                {fit.more > 0 ? (
                  <div className="dd-more">
                    {fit.shown === 0
                      ? `${fit.more} behavior${fit.more === 1 ? '' : 's'}`
                      : `+${fit.more} more`}
                  </div>
                ) : null}
              </div>
            ) : null
          ) : null}

          {plan ? (
            <>
              {plan.notes.length ? (
                <div className="dd-bullets">
                  {plan.notes.map((b) => (
                    <BulletRow key={b.bullet.id} item={b} blockId={id} selected={selected} />
                  ))}
                </div>
              ) : null}
              {plan.ops.length ? <div className="dd-section">Operations</div> : null}
              {plan.ops.map((op) => (
                <OpRow key={op.id} op={op} index={index} run={run} blockId={id} selected={selected} />
              ))}
              {plan.internalOps.map((op) => (
                <div className="dd-sig dd-op-internal" key={op.id} title={op.signature}>
                  {op.signature ? shortSignature(op.signature) : op.name} · internal
                </div>
              ))}
              {plan.data.length ? <div className="dd-section">Data</div> : null}
              {plan.data.map((dt) => (
                <div className="dd-data" key={dt.id} title={dt.signature}>
                  {dt.signature ?? dt.name}
                </div>
              ))}
              <div className="dd-block-foot">
                {plan.hasInternals ? (
                  <button
                    type="button"
                    className="dd-link-btn nodrag"
                    data-testid="internals"
                    onClick={(e) => {
                      e.stopPropagation();
                      useDeck.getState().toggleInternals(id);
                    }}
                  >
                    {showInternals ? 'Hide internals' : 'Show internals'}
                  </button>
                ) : null}
                <span className="dd-spacer" />
                <span>
                  {plan.ops.length} operation{plan.ops.length === 1 ? '' : 's'}
                  {gaps ? ` · ${gaps} not followed` : ''}
                </span>
              </div>
              {showInternals ? <Arcs index={index} id={id} showInternals={showInternals} /> : null}
            </>
          ) : null}

          {rows.length ? <Drawer rows={rows} run={run} blockId={id} /> : null}
        </div>
        {clipped ? <div className="dd-fade-bottom" /> : null}
      </div>
      {state && state !== 'removed' && state !== 'renamed' ? (
        <div className="dd-block-flag">
          <StateBadge state={state} />
        </div>
      ) : null}
      <Ports />
    </div>
  );
});
