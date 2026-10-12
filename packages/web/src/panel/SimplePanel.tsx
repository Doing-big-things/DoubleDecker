// The detail panel in the simple view (spec §3.13): what a part is for in plain words, what it
// talks to, a place to ask for something new, and a way in to the blocks behind it.
import {
  type DeckIndex,
  type PlainLine,
  type SimpleDeck,
  type SimpleLink,
  type SimplePart,
  testStats,
} from '@decker/deck-model';
import { ArrowDownLeft, ArrowUpRight, Network, Pencil, X } from 'lucide-react';
import { useState } from 'react';
import { StateBadge, TestsChip, testsLabel } from '../map/BlockNode';
import { linkRequested } from '../model/simple';
import { currentRun, useDeck } from '../state/store';

const originOf = (line: PlainLine): string =>
  line.origin === 'authored'
    ? 'written by hand'
    : line.origin === 'summarized'
      ? 'AI summary'
      : line.basis === 'name'
        ? 'from names in the code'
        : 'from a comment in the code';

function Close() {
  return (
    <button
      type="button"
      className="dd-icon-btn"
      style={{ width: 22, height: 22 }}
      aria-label="Close panel"
      data-testid="panel-close"
      onClick={() => useDeck.getState().select(null)}
    >
      <X size={14} />
    </button>
  );
}

/** A line of plain language that can be said better by hand. Emptying it restores what was derived. */
function Rewritable({
  line,
  placeholder,
  onSave,
  testId,
}: {
  line: PlainLine | undefined;
  placeholder: string;
  onSave: (text: string) => void;
  testId: string;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        className="dd-input"
        defaultValue={line?.text ?? ''}
        placeholder={placeholder}
        maxLength={200}
        autoFocus
        data-testid={`${testId}-input`}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onSave(e.currentTarget.value);
            setEditing(false);
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setEditing(false);
          }
        }}
        onBlur={() => setEditing(false)}
      />
    );
  }
  return (
    <div className="dd-plain-line" data-testid={testId}>
      <span>{line?.text ?? <i style={{ color: 'var(--faint)' }}>{placeholder}</i>}</span>
      <button
        type="button"
        className="dd-mini"
        title="Say this in your own words"
        aria-label="Rewrite"
        data-testid={`${testId}-edit`}
        onClick={() => setEditing(true)}
      >
        <Pencil size={11} />
      </button>
      {line ? (
        <span className="dd-origin" data-o={line.origin}>
          {originOf(line)}
        </span>
      ) : null}
    </div>
  );
}

function AskBox({ part }: { part: SimplePart }) {
  const [text, setText] = useState('');
  const send = () => {
    if (!text.trim()) return;
    useDeck.getState().addBullet(part.id, text);
    setText('');
  };
  return (
    <div className="dd-ask-box">
      <textarea
        className="dd-input"
        rows={2}
        value={text}
        maxLength={400}
        placeholder={`Ask for something new in ${part.name}, in your own words`}
        aria-label={`Ask for something new in ${part.name}`}
        data-testid="panel-ask"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <button
        type="button"
        className="dd-btn is-primary"
        disabled={!text.trim()}
        data-testid="panel-ask-send"
        onClick={send}
      >
        Add request
      </button>
    </div>
  );
}

function Line({ line, pending }: { line: PlainLine; pending: boolean }) {
  return (
    <div className="dd-row" data-testid="panel-line" data-state={pending ? 'requested' : ''}>
      <span
        className="dd-mark"
        data-o={line.origin === 'declared' ? undefined : line.origin}
        aria-hidden="true"
      />
      <span className="dd-row-main" style={pending ? { color: 'var(--requested)' } : undefined}>
        {line.text}
      </span>
      {pending ? (
        <>
          <button
            type="button"
            className="dd-mini"
            title="Take this request back"
            aria-label="Take this request back"
            data-testid="panel-unask"
            onClick={() => useDeck.getState().removeOp(line.id)}
          >
            <X size={11} />
          </button>
          <StateBadge state="requested" />
        </>
      ) : (
        <span className="dd-origin" data-o={line.origin}>
          {originOf(line)}
        </span>
      )}
    </div>
  );
}

function LinkRow({ link, dir, deck }: { link: SimpleLink; dir: 'in' | 'out'; deck: SimpleDeck }) {
  const other = deck.partById.get(dir === 'in' ? link.from : link.to);
  const pending = useDeck((s) => linkRequested(link, s.marks) === 'all');
  if (!other) return null;
  const drawn = !link.hidden;
  return (
    <button
      type="button"
      className="dd-row"
      data-testid="panel-connection"
      title="Show this connection"
      onClick={() => useDeck.getState().select(drawn ? link.id : other.id, { fly: !drawn })}
      onMouseEnter={() => useDeck.getState().hover(drawn ? link.id : other.id)}
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
          {link.label.text}
          {link.minor ? ' · not drawn' : ''}
        </span>
      </span>
      {pending ? <StateBadge state="requested" /> : null}
    </button>
  );
}

export function PartPanel({ part, deck, index }: { part: SimplePart; deck: SimpleDeck; index: DeckIndex }) {
  const run = useDeck(currentRun);
  const marks = useDeck((s) => s.marks);
  const finding = useDeck((s) => (s.review ? s.simpleState.get(part.id) : undefined));
  const st = useDeck.getState;
  const blocks = part.blocks.map((id) => index.byId.get(id)!).filter(Boolean);
  const tests = new Set(blocks.flatMap((b) => index.testsOf.get(b.id) ?? []));
  const stats = testStats([...tests], run);
  const isPending = (l: PlainLine) => marks.get(l.id)?.state === 'requested';
  const asked = part.asked.filter(isPending);
  const kept = part.asked.filter((l) => !isPending(l));
  const out = deck.links.filter((l) => l.from === part.id && !l.wiring);
  const into = deck.links.filter((l) => l.to === part.id && !l.wiring);
  const builds = deck.links
    .filter((l) => l.from === part.id && l.wiring)
    .map((l) => deck.partById.get(l.to)?.name);
  return (
    <>
      <div className="dd-panel-head">
        <div className="dd-panel-kind">
          <span>Area</span>
          <span className="dd-spacer" />
          <Close />
        </div>
        <h2 className="dd-panel-name" data-testid="panel-name">
          {part.name} <StateBadge state={finding} />
        </h2>
        <div className="dd-panel-sub">
          {blocks.length} block{blocks.length === 1 ? '' : 's'} · {testsLabel(stats)}
        </div>
      </div>
      <div className="dd-panel-body">
        <AskBox part={part} />
        {asked.length ? (
          <>
            <div className="dd-h">
              Asked for <small>not built yet</small>
            </div>
            {asked.map((l) => (
              <Line key={l.id} line={l} pending />
            ))}
          </>
        ) : null}

        <div className="dd-h">What it is for</div>
        <Rewritable
          line={part.summary}
          placeholder="Say what this is for"
          testId="panel-summary"
          onSave={(text) => st().describePlain({ part: part.id }, text)}
        />

        {part.described.length || kept.length ? <div className="dd-h">What it does</div> : null}
        {part.described.map((l) => (
          <Line key={l.id} line={l} pending={false} />
        ))}
        {kept.map((l) => (
          <Line key={l.id} line={l} pending={false} />
        ))}

        {out.length || into.length ? <div className="dd-h">Talks to</div> : null}
        {out.map((l) => (
          <LinkRow key={l.id} link={l} dir="out" deck={deck} />
        ))}
        {into.map((l) => (
          <LinkRow key={l.id} link={l} dir="in" deck={deck} />
        ))}
        {builds.length ? (
          <div className="dd-note">Also puts together {builds.join(', ')} when the system starts.</div>
        ) : null}

        {part.externals.length ? (
          <>
            <div className="dd-h">
              Outside this repository <small>{part.externals.length}</small>
            </div>
            <div className="dd-row" style={{ cursor: 'default' }}>
              <span className="dd-row-main">{part.externals.map((e) => e.name).join(', ')}</span>
            </div>
          </>
        ) : null}

        {blocks.length ? (
          <>
            <div className="dd-h">
              Inside <small>{blocks.length}</small>
              <button
                type="button"
                className="dd-link-btn"
                style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                data-testid="panel-open"
                onClick={() => st().setView('advanced', { focus: part.id })}
              >
                <Network size={12} /> Open in the advanced view
              </button>
            </div>
            {blocks.map((b) => (
              <button
                type="button"
                className="dd-row"
                key={b.id}
                data-testid="panel-block"
                title="Show this block in the advanced view"
                onClick={() => st().select(b.id, { fly: true })}
              >
                <span className="dd-row-main">
                  {b.name}
                  {b.summary ? <span className="dd-row-sub">{b.summary.text}</span> : null}
                </span>
                <TestsChip stats={testStats(index.testsOf.get(b.id) ?? [], run)} />
              </button>
            ))}
          </>
        ) : null}
      </div>
    </>
  );
}

export function ConnectionPanel({ link, deck }: { link: SimpleLink; deck: SimpleDeck }) {
  const marks = useDeck((s) => s.marks);
  const finding = useDeck((s) => s.simpleState.get(link.id));
  const st = useDeck.getState;
  const from = deck.partById.get(link.from);
  const to = deck.partById.get(link.to);
  const requested = linkRequested(link, marks);
  const real = link.edges.filter((e) => e.evidence.length > 0).length;
  return (
    <>
      <div className="dd-panel-head">
        <div className="dd-panel-kind">
          <span>Connection</span>
          <span className="dd-spacer" />
          <Close />
        </div>
        <h2 className="dd-panel-name" data-testid="panel-name">
          {from?.name} → {to?.name}{' '}
          <StateBadge state={finding ?? (requested === 'all' ? 'requested' : undefined)} />
        </h2>
        <div className="dd-panel-sub">
          {real === 0
            ? 'Asked for. Nothing in the code does this yet.'
            : `${real} place${real === 1 ? '' : 's'} in the code where ${from?.name} calls ${to?.name}`}
        </div>
      </div>
      <div className="dd-panel-body">
        <div className="dd-h">In a few words</div>
        {requested === 'all' ? (
          <div className="dd-plain-line" data-testid="panel-label">
            <span style={{ color: 'var(--requested)' }}>{link.label.text}</span>
          </div>
        ) : (
          <Rewritable
            line={link.label}
            placeholder="Say what this connection is for"
            testId="panel-label"
            onSave={(text) => st().describePlain({ from: link.from, to: link.to }, text)}
          />
        )}

        {link.asks.length ? (
          <div className="dd-h">
            What {from?.name} asks of {to?.name} <small>{link.asks.length}</small>
          </div>
        ) : null}
        {link.asks.map((l) => (
          <Line key={l.id} line={l} pending={marks.get(l.id)?.state === 'requested'} />
        ))}

        <div className="dd-h">Ends</div>
        {[from, to].map((p) =>
          p ? (
            <button
              type="button"
              className="dd-row"
              key={p.id}
              onClick={() => st().select(p.id, { fly: true })}
            >
              <span className="dd-row-main">
                {p.name}
                {p.summary ? <span className="dd-row-sub">{p.summary.text}</span> : null}
              </span>
            </button>
          ) : null,
        )}
        {real > 0 ? (
          <button
            type="button"
            className="dd-add"
            data-testid="panel-open"
            onClick={() => st().setView('advanced', { focus: [link.from, link.to] })}
          >
            <Network size={12} /> See the arrows in the advanced view
          </button>
        ) : null}
      </div>
    </>
  );
}
