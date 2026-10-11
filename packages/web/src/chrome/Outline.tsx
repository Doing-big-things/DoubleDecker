// The outline view (spec §3.12): the same areas, blocks, bullets and arrows as a searchable
// tree. It is the textual equivalent of the map and the format agents receive.
import { cardBullets, type DeckIndex, type DeckNode, type Id, renderDeckText } from '@decker/deck-model';
import { ClipboardCopy, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Caret, Mark } from '../map/BlockNode';
import { useDeck } from '../state/store';

function matches(index: DeckIndex, node: DeckNode, q: string): boolean {
  if (!q) return true;
  if (node.name.toLowerCase().includes(q)) return true;
  if (node.kind === 'block')
    return (
      cardBullets(index, node.id).some((b) => b.bullet.text.toLowerCase().includes(q)) ||
      (node.summary?.text.toLowerCase().includes(q) ?? false)
    );
  return (index.children.get(node.id) ?? []).some(
    (c) => (c.kind === 'area' || c.kind === 'block') && matches(index, c, q),
  );
}

export function Outline() {
  const open = useDeck((s) => s.outlineOpen);
  const index = useDeck((s) => s.index);
  const selectedId = useDeck((s) => s.selectedId);
  const [query, setQuery] = useState('');
  const [openIds, setOpenIds] = useState<Set<Id> | null>(null);
  const q = query.trim().toLowerCase();

  const expanded = useMemo(() => {
    if (openIds) return openIds;
    return new Set<Id>(index ? (index.children.get(index.system.id) ?? []).map((n) => n.id) : []);
  }, [openIds, index]);

  if (!open || !index) return null;
  const st = useDeck.getState;
  const toggle = (id: Id) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpenIds(next);
  };

  const renderNode = (node: DeckNode, depth: number): React.ReactNode => {
    if (node.kind !== 'area' && node.kind !== 'block') return null;
    if (!matches(index, node, q)) return null;
    const isOpen = q ? true : expanded.has(node.id);
    const pad = { paddingLeft: 6 + depth * 14 };
    return (
      <div
        key={node.id}
        role="treeitem"
        tabIndex={-1}
        aria-expanded={isOpen}
        aria-selected={selectedId === node.id}
      >
        <button
          type="button"
          className={`dd-tree-row${selectedId === node.id ? ' is-selected' : ''}`}
          data-kind={node.kind}
          data-testid="outline-row"
          style={pad}
          onClick={() => {
            st().select(node.id, { fly: true });
            if (!isOpen) toggle(node.id);
          }}
        >
          <span
            className={`twisty${isOpen ? ' is-open' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              toggle(node.id);
            }}
          >
            <Caret />
          </span>
          <span className="t">{node.name}</span>
        </button>
        {isOpen && node.kind === 'area'
          ? (index.children.get(node.id) ?? []).map((c) => renderNode(c, depth + 1))
          : null}
        {isOpen && node.kind === 'block' ? (
          <>
            {cardBullets(index, node.id).map((b) => (
              <button
                type="button"
                className="dd-tree-row"
                data-kind="bullet"
                key={b.bullet.id}
                style={{ paddingLeft: 26 + depth * 14 }}
                title={b.bullet.text}
                onClick={() => st().select(node.id, { fly: true, op: b.opId ?? null })}
              >
                <Mark origin={b.bullet.origin} />
                <span className="t">{b.bullet.text}</span>
              </button>
            ))}
            {(index.linksOut.get(node.id) ?? []).map((l) => (
              <button
                type="button"
                className="dd-tree-row"
                data-kind="arrow"
                key={l.id}
                style={{ paddingLeft: 26 + depth * 14 }}
                onClick={() => st().select(l.to, { fly: true })}
              >
                <span className="t">
                  → {index.byId.get(l.to)?.name}
                  {l.label ? ` · ${l.label}` : ''}
                </span>
              </button>
            ))}
          </>
        ) : null}
      </div>
    );
  };

  return (
    <aside className="dd-outline" data-testid="outline" aria-label="Outline">
      <div className="dd-outline-head">
        <input
          className="dd-input"
          placeholder="Filter the outline…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="outline-filter"
        />
        <button
          type="button"
          className="dd-icon-btn"
          aria-label="Copy as deck text"
          title="Copy the whole deck as text"
          data-testid="copy-deck-text"
          onClick={() => {
            void navigator.clipboard.writeText(renderDeckText(index)).then(
              () => st().toast('Deck text copied'),
              () => st().toast('Copying was blocked by the browser', true),
            );
          }}
        >
          <ClipboardCopy size={15} />
        </button>
        <button
          type="button"
          className="dd-icon-btn"
          aria-label="Close outline"
          onClick={() => st().set({ outlineOpen: false })}
        >
          <X size={15} />
        </button>
      </div>
      <div className="dd-outline-body" role="tree">
        {(index.children.get(index.system.id) ?? []).map((n) => renderNode(n, 0))}
      </div>
    </aside>
  );
}
