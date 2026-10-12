// The detail panel (spec §3.2, §3.6): everything about the selection, one click from the code.
import {
  type Bullet,
  blocksUnder,
  cardBullets,
  childrenOfKind,
  type DeckIndex,
  type DeckNode,
  type Id,
  type Link,
  linkTests,
  operationsOf,
  pathTo,
  type TestRun,
  testStats,
} from '@decker/deck-model';
import { ArrowDownLeft, ArrowUpRight, Pin, Plus, Trash2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { removeSelected } from '../lib/keys';
import { GLYPH, Mark, StateBadge, TestsChip, testsLabel } from '../map/BlockNode';
import { camera } from '../map/camera';
import { linkOf, linkState } from '../map/LinkEdge';
import { testGroups } from '../model/measure';
import { currentRun, type Peek, useDeck, visualState } from '../state/store';
import { CodePeek, DiffView } from './CodePeek';
import { ReviewPanel } from './ReviewPanel';
import { ConnectionPanel, PartPanel } from './SimplePanel';

const ORIGIN: Record<string, string> = {
  doc: 'doc comment',
  name: 'from its name',
  summarized: 'AI summary',
  authored: 'authored',
};
const originLabel = (b: Bullet) => (b.origin === 'declared' ? ORIGIN[b.basis ?? 'doc']! : ORIGIN[b.origin]!);
const GAP_REASON: Record<string, string> = {
  'dynamic-call': 'a call whose target is computed at run time',
  'dynamic-import': 'a dynamic import',
  untyped: 'an untyped (any) call',
  'parse-error': 'a file that did not parse',
  unsupported: 'a construct the extractor does not support',
};

function peekOf(node: DeckNode): Peek | null {
  const ref = node.source[0];
  return ref ? { path: ref.path, startLine: ref.startLine, endLine: ref.endLine, title: node.name } : null;
}

function BulletLine({ bullet, ownerId, canEdit = true }: { bullet: Bullet; ownerId: Id; canEdit?: boolean }) {
  const [editing, setEditing] = useState(false);
  const state = useDeck((s) => visualState(s, bullet.id));
  const before = useDeck((s) => s.marks.get(bullet.id)?.before);
  const st = useDeck.getState;
  return (
    <div className="dd-row is-hover" data-testid="panel-bullet" data-state={state ?? ''}>
      <Mark origin={bullet.origin} />
      <span className="dd-row-main">
        {editing ? (
          <input
            className="dd-input"
            defaultValue={bullet.text}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                st().setBullet(ownerId, bullet, e.currentTarget.value);
                setEditing(false);
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                setEditing(false);
              }
            }}
            onBlur={() => setEditing(false)}
          />
        ) : (
          <span
            style={{
              cursor: canEdit ? 'text' : undefined,
              textDecoration: state === 'removed' ? 'line-through' : undefined,
              color: state === 'changed' || state === 'requested' ? 'var(--requested)' : undefined,
            }}
            onClick={() => canEdit && setEditing(true)}
            title={canEdit ? 'Click to change this behavior' : undefined}
          >
            {bullet.text}
          </span>
        )}
        {before ? <span className="dd-row-sub">was: {before}</span> : null}
        {bullet.derivedFrom && bullet.origin !== 'authored' ? (
          <button
            type="button"
            className="dd-row-sub dd-link-btn"
            style={{ color: 'var(--faint)' }}
            onClick={() =>
              st().openPeek({
                path: bullet.derivedFrom!.path,
                startLine: bullet.derivedFrom!.startLine,
                endLine: bullet.derivedFrom!.endLine,
                title: bullet.text,
              })
            }
          >
            {bullet.derivedFrom.path.split('/').at(-1)}:{bullet.derivedFrom.startLine}
          </button>
        ) : null}
      </span>
      <span className="dd-row-actions">
        {bullet.origin === 'summarized' ? (
          <>
            <button
              type="button"
              className="dd-mini"
              title="Keep this as an authored bullet"
              onClick={() => st().pinBullet(ownerId, bullet)}
            >
              <Pin size={11} />
            </button>
            <button
              type="button"
              className="dd-mini"
              title="Dismiss this summary"
              onClick={() => st().dismissBullet(bullet.id)}
            >
              <X size={11} />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="dd-mini"
            title="Request removing this behavior"
            onClick={() => st().requestRemove(bullet.id, 'bullet', `“${bullet.text}”`, ownerId)}
          >
            <Trash2 size={11} />
          </button>
        )}
      </span>
      {state ? (
        <StateBadge state={state === 'changed' ? 'requested' : state} />
      ) : (
        <span className="dd-origin" data-o={bullet.origin}>
          {originLabel(bullet)}
        </span>
      )}
    </div>
  );
}

function AddBullet({ targetId }: { targetId: Id }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="dd-add" onClick={() => setOpen(true)} data-testid="add-bullet">
        <Plus size={12} /> Add bullet
      </button>
    );
  }
  return (
    <input
      className="dd-input"
      style={{ marginTop: 4 }}
      placeholder="Describe a behavior, verb first, then press Enter"
      autoFocus
      data-testid="add-bullet-input"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.currentTarget.value.trim()) {
          useDeck.getState().addBullet(targetId, e.currentTarget.value);
          e.currentTarget.value = '';
        } else if (e.key === 'Escape') {
          e.stopPropagation();
          setOpen(false);
        }
      }}
      onBlur={() => setOpen(false)}
    />
  );
}

function LinkRow({ link, dir, index }: { link: Link; dir: 'in' | 'out'; index: DeckIndex }) {
  const other = index.byId.get(dir === 'in' ? link.from : link.to);
  const state = useDeck((s) => linkState(s, link));
  if (!other) return null;
  return (
    <button
      type="button"
      className="dd-row"
      data-testid="panel-arrow"
      title="Fly to the other end"
      onClick={() => useDeck.getState().select(other.id, { fly: true })}
      onMouseEnter={() => useDeck.getState().hover(link.id)}
      onMouseLeave={() => useDeck.getState().hover(null)}
    >
      {dir === 'in' ? (
        <ArrowDownLeft size={13} color="var(--faint)" style={{ marginTop: 2 }} />
      ) : (
        <ArrowUpRight size={13} color="var(--faint)" style={{ marginTop: 2 }} />
      )}
      <span className="dd-row-main">
        {other.name}
        <span className="dd-row-sub">
          {link.label ?? 'call'}
          {link.count > 1 ? ` · ${link.count} call sites` : ''}
          {link.indirect ? ` · ${link.indirect}` : ''}
        </span>
      </span>
      <StateBadge state={state} />
    </button>
  );
}

function Overview({ block, index, run }: { block: DeckNode; index: DeckIndex; run: TestRun | null }) {
  const focusOpId = useDeck((s) => s.focusOpId);
  const state = useDeck((s) => visualState(s, block.id));
  const baseline = useDeck((s) => s.bundle?.changedSinceBaseline.includes(block.id) ?? false);
  const commit = useDeck((s) => s.bundle?.snapshot.sourceCommit ?? '');
  // A block dragged into another area is drawn there; its code is still where it was.
  const home = useDeck((s) =>
    s.groups[block.id] ? s.bundle?.snapshot.nodes.find((n) => n.id === block.id)?.parentId : undefined,
  );
  const homeName = home ? index.byId.get(home)?.name : undefined;
  const bullets = cardBullets(index, block.id);
  const ops = operationsOf(index, block.id);
  const data = childrenOfKind(index, block.id, 'data');
  const ins = index.linksIn.get(block.id) ?? [];
  const outs = index.linksOut.get(block.id) ?? [];
  const types = index.dataLinks.filter((l) => l.from === block.id || l.to === block.id);
  const externals = index.externalsOf.get(block.id) ?? [];
  const gaps = index.gapsOf.get(block.id) ?? [];
  const stats = testStats(index.testsOf.get(block.id) ?? [], run);
  const st = useDeck.getState;

  return (
    <>
      <div className="dd-h">
        Behavior <small>{bullets.length}</small>
      </div>
      {bullets.map((b) => (
        <BulletLine key={b.bullet.id} bullet={b.bullet} ownerId={b.ownerId} />
      ))}
      <AddBullet targetId={block.id} />

      {ops.length ? (
        <div className="dd-h">
          Operations <small>{ops.length}</small>
        </div>
      ) : null}
      {ops.map((op) => {
        const focus = focusOpId === op.id;
        const peek = peekOf(op);
        return (
          <div key={op.id}>
            <button
              type="button"
              className={`dd-row${focus ? ' is-focus' : ''}`}
              data-testid="panel-op"
              onClick={() => st().select(block.id, { op: focus ? null : op.id, keepTab: true })}
            >
              <span className="dd-row-main mono" style={{ fontSize: 11.5, overflowWrap: 'anywhere' }}>
                {op.signature ?? op.name}
                {op.tags?.length ? (
                  <span className="dd-row-sub" style={{ fontFamily: 'var(--font-sans)' }}>
                    {op.tags.join(' · ')}
                  </span>
                ) : null}
              </span>
              <TestsChip stats={testStats(index.testsOf.get(op.id) ?? [], run)} />
            </button>
            {focus ? (
              <div style={{ padding: '2px 0 6px 12px' }}>
                {op.bullets.map((b) => (
                  <BulletLine key={b.id} bullet={b} ownerId={op.id} />
                ))}
                <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
                  <AddBullet targetId={op.id} />
                  {peek ? (
                    <button type="button" className="dd-add" onClick={() => st().openPeek(peek)}>
                      View source
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}

      {data.length ? (
        <div className="dd-h">
          Data <small>{data.length}</small>
        </div>
      ) : null}
      {data.map((d) => {
        const peek = peekOf(d);
        return (
          <button
            type="button"
            className="dd-row mono"
            key={d.id}
            style={{ fontSize: 11.5 }}
            onClick={() => peek && st().openPeek(peek)}
          >
            {d.signature ?? d.name}
          </button>
        );
      })}

      {ins.length + outs.length + types.length + externals.length ? (
        <div className="dd-h">
          Arrows{' '}
          <small>
            {ins.length} in · {outs.length} out
          </small>
        </div>
      ) : null}
      {ins.map((l) => (
        <LinkRow key={l.id} link={l} dir="in" index={index} />
      ))}
      {outs.map((l) => (
        <LinkRow key={l.id} link={l} dir="out" index={index} />
      ))}
      {types.map((l) => {
        const other = index.byId.get(l.from === block.id ? l.to : l.from);
        return other ? (
          <button
            type="button"
            className="dd-row"
            key={l.id}
            onClick={() => st().select(other.id, { fly: true })}
          >
            <span className="dd-row-main" style={{ color: 'var(--muted)' }}>
              {other.name}
              <span className="dd-row-sub">
                {l.from === block.id ? 'uses its types' : 'uses types from here'}
              </span>
            </span>
          </button>
        ) : null;
      })}
      {externals.length ? (
        <div className="dd-row" style={{ color: 'var(--muted)' }}>
          <span className="dd-row-main">
            <span className="dd-row-sub">External</span>
            <span className="mono" style={{ fontSize: 11.5 }}>
              {externals.map((e) => e.name).join(', ')}
            </span>
          </span>
        </div>
      ) : null}

      <div className="dd-h">State and evidence</div>
      <dl className="dd-kv">
        <dt>On the map</dt>
        <dd>
          {state ? (
            <StateBadge state={state === 'renamed' || state === 'changed' ? 'requested' : state} />
          ) : baseline ? (
            'Changed since the accepted baseline'
          ) : (
            'Accepted baseline'
          )}
        </dd>
        {homeName ? (
          <>
            <dt>Drawn in</dt>
            <dd data-testid="regrouped">
              {index.byId.get(block.parentId ?? '')?.name}, by hand. Its code is in {homeName}.{' '}
              <button
                type="button"
                className="dd-link-btn"
                data-testid="put-back"
                onClick={() => st().ungroup(block.id)}
              >
                Put back
              </button>
            </dd>
          </>
        ) : null}
        <dt>Extraction</dt>
        <dd>
          {block.coverage === 'full'
            ? 'Fully followed'
            : block.coverage === 'partial'
              ? `Partly followed: ${gaps.length} gap${gaps.length === 1 ? '' : 's'}`
              : `Opaque: ${gaps.length} gap${gaps.length === 1 ? '' : 's'}`}
        </dd>
        <dt>Tests</dt>
        <dd>{testsLabel(stats)}</dd>
        <dt>Commit</dt>
        <dd className="mono" style={{ fontSize: 11.5 }}>
          {commit.slice(0, 10)}
        </dd>
      </dl>
      {gaps.map((g, i) => (
        <button
          type="button"
          className="dd-row"
          key={i}
          data-testid="panel-gap"
          onClick={() =>
            st().openPeek({
              path: g.source.path,
              startLine: g.source.startLine,
              endLine: g.source.endLine,
              title: 'Not followed',
            })
          }
        >
          <span className="dd-opaque" style={{ fontSize: 11 }}>
            ?
          </span>
          <span className="dd-row-main">
            Could not follow {GAP_REASON[g.reason]}
            <span className="dd-row-sub mono">
              {g.source.path.split('/').at(-1)}:{g.source.startLine}
            </span>
          </span>
        </button>
      ))}
    </>
  );
}

function TestsTab({ block, index, run }: { block: DeckNode; index: DeckIndex; run: TestRun | null }) {
  const groups = testGroups(index, block.id, run);
  if (groups.length === 0) return <div className="dd-empty">No test calls this block directly.</div>;
  return (
    <>
      <p className="dd-note">
        A test hangs off an operation when it calls that operation directly. This is not coverage.
      </p>
      {groups.map((g) => (
        <div key={g.id}>
          <div className="dd-h" style={{ textTransform: 'none', letterSpacing: 0 }}>
            <span className="mono" style={{ color: 'var(--text)', fontSize: 12 }}>
              {g.label}
            </span>
            <span style={{ marginLeft: 'auto' }}>
              <TestsChip stats={testStats(g.tests, run)} />
            </span>
          </div>
          {g.tests.map((t) => {
            const status = run?.results[t.id] ?? 'none';
            const via = t.targets.find((x) => x.id === g.id)?.via;
            return (
              <button
                type="button"
                className="dd-row"
                key={t.id}
                data-testid="panel-test"
                onClick={() =>
                  useDeck.getState().openPeek({
                    path: t.source.path,
                    startLine: t.source.startLine,
                    endLine: t.source.endLine,
                    title: t.name,
                  })
                }
              >
                <span
                  className="dd-glyph"
                  data-s={status}
                  title={status === 'none' ? 'not run at this commit' : status}
                >
                  {GLYPH[status]}
                </span>
                <span className="dd-row-main">
                  {t.name}
                  {via && via !== 'calls' ? (
                    <span className="dd-row-sub">
                      {via === 'imports'
                        ? 'imports the block; no direct call found'
                        : 'beside the block by naming convention'}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}

function BlockPanel({ block, index }: { block: DeckNode; index: DeckIndex }) {
  const tab = useDeck((s) => s.panelTab);
  const peek = useDeck((s) => s.peek);
  const focusOpId = useDeck((s) => s.focusOpId);
  const review = useDeck((s) => s.review);
  const run = useDeck(currentRun);
  const renamedFrom = useDeck((s) =>
    s.marks.get(block.id)?.state === 'renamed' ? s.marks.get(block.id)?.before : undefined,
  );
  const state = useDeck((s) => visualState(s, block.id));
  const path = pathTo(index, block.id);
  const tests = index.testsOf.get(block.id) ?? [];
  const focusOp = focusOpId ? index.byId.get(focusOpId) : undefined;
  const shown = peek ?? (focusOp ? peekOf(focusOp) : null) ?? peekOf(block);
  const paths = new Set(block.source.map((r) => r.path));
  const st = useDeck.getState;

  return (
    <>
      <div className="dd-panel-head">
        <div className="dd-panel-kind">
          <span>Block</span>
          <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 450 }}>
            {path
              .slice(1, -1)
              .map((n) => n.name)
              .join(' ▸ ')}
          </span>
          <span className="dd-spacer" />
          <button
            type="button"
            className="dd-icon-btn"
            style={{ width: 22, height: 22 }}
            aria-label="Request removal"
            title="Request removing this block  (Delete)"
            onClick={removeSelected}
          >
            <Trash2 size={13} />
          </button>
          <button
            type="button"
            className="dd-icon-btn"
            style={{ width: 22, height: 22 }}
            aria-label="Close panel"
            onClick={() => st().select(null)}
            data-testid="panel-close"
          >
            <X size={14} />
          </button>
        </div>
        <h2 className="dd-panel-name" data-testid="panel-name">
          {renamedFrom ? (
            <s style={{ color: 'var(--faint)', fontWeight: 450, marginRight: 8 }}>{renamedFrom}</s>
          ) : null}
          {block.name} {state === 'requested' ? <StateBadge state="requested" /> : null}
        </h2>
        {block.summary ? <div className="dd-panel-sub">{block.summary.text}</div> : null}
      </div>
      <div className="dd-tabs" role="tablist">
        {(['overview', 'tests', 'source', ...(review ? (['diff'] as const) : [])] as const).map((t) => (
          <button
            type="button"
            role="tab"
            key={t}
            className="dd-tab"
            aria-selected={tab === t}
            data-testid={`tab-${t}`}
            onClick={() => st().set({ panelTab: t })}
          >
            {t[0]!.toUpperCase() + t.slice(1)}
            {t === 'tests' ? <small>{tests.length}</small> : null}
          </button>
        ))}
      </div>
      <div className="dd-panel-body">
        {tab === 'overview' ? <Overview block={block} index={index} run={run} /> : null}
        {tab === 'tests' ? <TestsTab block={block} index={index} run={run} /> : null}
        {tab === 'source' ? (
          shown ? (
            <CodePeek peek={shown} />
          ) : (
            <div className="dd-empty">This block has no source yet. It is a request.</div>
          )
        ) : null}
        {tab === 'diff' && review ? <DiffView files={review.diff.filter((f) => paths.has(f.path))} /> : null}
      </div>
    </>
  );
}

function AreaPanel({ area, index }: { area: DeckNode; index: DeckIndex }) {
  const run = useDeck(currentRun);
  const blocks = blocksUnder(index, area.id);
  const tests = new Set(blocks.flatMap((b) => index.testsOf.get(b.id) ?? []));
  const stats = testStats([...tests], run);
  const st = useDeck.getState;
  return (
    <>
      <div className="dd-panel-head">
        <div className="dd-panel-kind">
          <span>Area</span>
          <span className="dd-spacer" />
          <button
            type="button"
            className="dd-icon-btn"
            style={{ width: 22, height: 22 }}
            aria-label="Close panel"
            onClick={() => st().select(null)}
          >
            <X size={14} />
          </button>
        </div>
        <h2 className="dd-panel-name" data-testid="panel-name">
          {area.name}
        </h2>
        <div className="dd-panel-sub">
          {blocks.length} block{blocks.length === 1 ? '' : 's'} · {testsLabel(stats)}
        </div>
      </div>
      <div className="dd-panel-body">
        <div className="dd-h">Blocks</div>
        {blocks.map((b) => (
          <button
            type="button"
            className="dd-row"
            key={b.id}
            onClick={() => st().select(b.id, { fly: true })}
          >
            <span className="dd-row-main">
              {b.name}
              {b.summary ? <span className="dd-row-sub">{b.summary.text}</span> : null}
            </span>
            <TestsChip stats={testStats(index.testsOf.get(b.id) ?? [], run)} />
          </button>
        ))}
      </div>
    </>
  );
}

function LinkPanel({ link, index }: { link: Link; index: DeckIndex }) {
  const state = useDeck((s) => linkState(s, link));
  const marks = useDeck((s) => s.marks);
  const from = index.byId.get(link.from);
  const to = index.byId.get(link.to);
  const st = useDeck.getState;
  const requested = link.edges.find((e) => marks.get(e.id)?.state === 'requested');
  const bulletTarget = requested?.id ?? link.edges[0]?.id;
  const run = useDeck(currentRun);
  const tests = linkTests(index, link);
  const isArea = link.id.startsWith('aln:');
  return (
    <>
      <div className="dd-panel-head">
        <div className="dd-panel-kind">
          <span>Arrow</span>
          <span className="dd-spacer" />
          {!isArea ? (
            <button
              type="button"
              className="dd-icon-btn"
              style={{ width: 22, height: 22 }}
              aria-label="Request removal"
              title="Request removing this arrow  (Delete)"
              onClick={removeSelected}
            >
              <Trash2 size={13} />
            </button>
          ) : null}
          <button
            type="button"
            className="dd-icon-btn"
            style={{ width: 22, height: 22 }}
            aria-label="Close panel"
            onClick={() => st().select(null)}
          >
            <X size={14} />
          </button>
        </div>
        <h2 className="dd-panel-name" data-testid="panel-name">
          {from?.name} → {to?.name}
        </h2>
        <div className="dd-panel-sub">
          {link.label ?? link.kinds.join(', ')} · {link.count}{' '}
          {link.count === 1 ? 'interaction' : 'interactions'} <StateBadge state={state} />
        </div>
      </div>
      <div className="dd-panel-body">
        {link.edges.some((e) => e.bullets.length) || requested ? <div className="dd-h">Behavior</div> : null}
        {link.edges.flatMap((e) => e.bullets.map((b) => <BulletLine key={b.id} bullet={b} ownerId={e.id} />))}
        {!isArea && bulletTarget ? <AddBullet targetId={bulletTarget} /> : null}

        {tests.length ? (
          <>
            <div className="dd-h">
              Tests <small>linked by its requirements</small>
              <span style={{ marginLeft: 'auto' }}>
                <TestsChip stats={testStats(tests, run)} />
              </span>
            </div>
            {tests.map((t) => {
              const status = run?.results[t.id] ?? 'none';
              return (
                <button
                  type="button"
                  className="dd-row"
                  key={t.id}
                  data-testid="panel-test"
                  onClick={() =>
                    st().openPeek({
                      path: t.source.path,
                      startLine: t.source.startLine,
                      endLine: t.source.endLine,
                      title: t.name,
                    })
                  }
                >
                  <span
                    className="dd-glyph"
                    data-s={status}
                    title={status === 'none' ? 'not run at this commit' : status}
                  >
                    {GLYPH[status]}
                  </span>
                  <span className="dd-row-main">{t.name}</span>
                </button>
              );
            })}
          </>
        ) : null}

        <div className="dd-h">
          Evidence <small>{link.edges.length}</small>
        </div>
        {link.edges.map((e) => {
          const a = index.byId.get(e.from);
          const b = index.byId.get(e.to);
          const ref = e.evidence[0];
          const edgeState = marks.get(e.id)?.state;
          return (
            <button
              type="button"
              className="dd-row"
              key={e.id}
              data-testid="panel-evidence"
              onClick={() => {
                if (!ref) return;
                st().select(index.blockOf.get(e.from) ?? e.from, { keepTab: true });
                st().openPeek({
                  path: ref.path,
                  startLine: ref.startLine,
                  endLine: ref.endLine,
                  title: `${a?.name} → ${b?.name}`,
                });
              }}
            >
              <span className="dd-row-main mono" style={{ fontSize: 11.5 }}>
                {isArea ? `${index.byId.get(index.blockOf.get(e.from) ?? '')?.name ?? ''}.` : ''}
                {a?.kind === 'operation' ? a.name : (a?.name ?? '?')} →{' '}
                {isArea ? `${index.byId.get(index.blockOf.get(e.to) ?? '')?.name ?? ''}.` : ''}
                {b?.kind === 'operation' ? b.name : (b?.name ?? '?')}
                <span className="dd-row-sub" style={{ fontFamily: 'var(--font-sans)' }}>
                  {e.kind}
                  {e.label ? ` · ${e.label}` : ''}
                  {e.indirect ? ` · ${e.indirect}` : ''}
                  {ref
                    ? ` · ${ref.path.split('/').at(-1)}:${ref.startLine}`
                    : edgeState === 'requested'
                      ? ' · requested, not in the code yet'
                      : ''}
                </span>
              </span>
            </button>
          );
        })}
        <div className="dd-h">Ends</div>
        {[from, to].map((n) =>
          n ? (
            <button
              type="button"
              className="dd-row"
              key={n.id}
              onClick={() => st().select(n.id, { fly: true })}
            >
              <span className="dd-row-main">{n.name}</span>
            </button>
          ) : null,
        )}
      </div>
    </>
  );
}

export function DetailPanel() {
  const open = useDeck((s) => s.panelOpen);
  const width = useDeck((s) => s.panelWidth);
  const index = useDeck((s) => s.index);
  const selectedId = useDeck((s) => s.selectedId);
  const review = useDeck((s) => s.review);
  const view = useDeck((s) => s.view);
  const simple = useDeck((s) => s.simple);
  const [resizing, setResizing] = useState(false);
  const start = useRef({ x: 0, w: 0 });

  if (!index || (!selectedId && !review) || (!open && !review)) return null;
  // The simple view has panels of its own: the same things, said in plain words.
  const plain = view === 'simple' && simple ? simple : null;
  const part = plain && selectedId ? plain.partById.get(selectedId) : undefined;
  const connection = plain && selectedId ? plain.linkById.get(selectedId) : undefined;
  const node = selectedId && !plain ? index.byId.get(selectedId) : undefined;
  const link = selectedId && !plain && !node ? linkOf(index, selectedId) : undefined;

  return (
    <aside className="dd-panel" style={{ width }} data-testid="panel" aria-label="Details">
      <div
        className={`dd-resize${resizing ? ' is-active' : ''}`}
        onPointerDown={(e) => {
          start.current = { x: e.clientX, w: width };
          setResizing(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!resizing) return;
          useDeck
            .getState()
            .set({ panelWidth: Math.min(720, Math.max(300, start.current.w + start.current.x - e.clientX)) });
        }}
        onPointerUp={() => setResizing(false)}
        onDoubleClick={() => useDeck.getState().set({ panelWidth: 380 })}
      />
      {node?.kind === 'block' ? <BlockPanel block={node} index={index} /> : null}
      {node?.kind === 'area' ? <AreaPanel area={node} index={index} /> : null}
      {link ? <LinkPanel link={link} index={index} /> : null}
      {part && plain ? <PartPanel part={part} deck={plain} index={index} /> : null}
      {connection && plain ? <ConnectionPanel link={connection} deck={plain} /> : null}
      {!node && !link && !part && !connection && review ? <ReviewPanel /> : null}
    </aside>
  );
}

export { camera };
