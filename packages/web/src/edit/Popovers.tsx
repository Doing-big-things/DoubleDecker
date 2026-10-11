// The small forms behind editing gestures (spec §3.8). Each one ends in a change operation.
import { type EdgeKind, freshId } from '@decker/deck-model';
import { useEffect, useRef, useState } from 'react';
import { useDeck } from '../state/store';

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.replace(/^\s*[-•▪*]\s*/, '').trim())
    .filter(Boolean);

function Frame({ x, y, children, onSubmit, testId }: { x: number; y: number; children: React.ReactNode; onSubmit: () => void; testId: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), top: Math.max(52, Math.min(y, window.innerHeight - r.height - 8)) });
  }, [x, y]);
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 39 }} onClick={() => useDeck.getState().set({ popover: null })} />
      <form
        ref={ref}
        className="dd-popover"
        style={{ position: 'fixed', ...pos }}
        data-testid={testId}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onSubmit();
          }
        }}
      >
        {children}
      </form>
    </>
  );
}

function EdgeForm({ from, to, x, y }: { from: string; to: string; x: number; y: number }) {
  const index = useDeck((s) => s.index);
  const [kind, setKind] = useState<EdgeKind>('api');
  const [label, setLabel] = useState('');
  const [bullets, setBullets] = useState('');
  const st = useDeck.getState;
  const submit = () => {
    st().addOp({ id: freshId('op'), type: 'add_edge', from, to, kind, label: label.trim() || undefined, bullets: lines(bullets) });
    st().set({ popover: null });
  };
  return (
    <Frame x={x} y={y} onSubmit={submit} testId="edge-form">
      <h4>
        New arrow: {index?.byId.get(from)?.name} → {index?.byId.get(to)?.name}
      </h4>
      <label htmlFor="dd-edge-kind">Kind</label>
      <div className="dd-seg" id="dd-edge-kind">
        {(['api', 'call', 'event'] as const).map((k) => (
          <button type="button" key={k} aria-pressed={kind === k} onClick={() => setKind(k)} data-testid={`kind-${k}`}>
            {k === 'api' ? 'API' : k === 'call' ? 'Call' : 'Event'}
          </button>
        ))}
      </div>
      <label htmlFor="dd-edge-label">Label</label>
      {/* biome-ignore lint/a11y/noAutofocus: the form opens in response to drawing the arrow */}
      <input id="dd-edge-label" className="dd-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Reserve stock" autoFocus data-testid="edge-label" />
      <label htmlFor="dd-edge-bullets">Behavior, one per line</label>
      <textarea id="dd-edge-bullets" className="dd-input" rows={4} value={bullets} onChange={(e) => setBullets(e.target.value)} placeholder={'Reserve every item before confirming an order\nNever reserve only part of an order'} data-testid="edge-bullets" />
      <div className="dd-popover-foot">
        <button type="button" className="dd-btn is-ghost" onClick={() => st().set({ popover: null })}>
          Cancel
        </button>
        <button type="submit" className="dd-btn is-primary" data-testid="edge-submit">
          Request arrow
        </button>
      </div>
    </Frame>
  );
}

function BlockForm({ parentId, x, y, position }: { parentId: string; x: number; y: number; position?: { x: number; y: number } }) {
  const index = useDeck((s) => s.index);
  const [name, setName] = useState('');
  const [bullets, setBullets] = useState('');
  const st = useDeck.getState;
  const submit = () => {
    if (!name.trim()) return;
    const id = freshId('op');
    st().addOp({ id, type: 'add_block', parentId, name: name.trim(), bullets: lines(bullets), position });
    st().set({ popover: null });
    setTimeout(() => st().select(id), 0);
  };
  return (
    <Frame x={x} y={y} onSubmit={submit} testId="block-form">
      <h4>New block in {index?.byId.get(parentId)?.name}</h4>
      <label htmlFor="dd-block-name">Name</label>
      {/* biome-ignore lint/a11y/noAutofocus: the form opens in response to N or a double-click */}
      <input id="dd-block-name" className="dd-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Notifications" autoFocus data-testid="block-name" />
      <label htmlFor="dd-block-bullets">Behavior, one per line</label>
      <textarea id="dd-block-bullets" className="dd-input" rows={4} value={bullets} onChange={(e) => setBullets(e.target.value)} placeholder={'Email a receipt when an order is placed'} data-testid="block-bullets" />
      <div className="dd-popover-foot">
        <button type="button" className="dd-btn is-ghost" onClick={() => st().set({ popover: null })}>
          Cancel
        </button>
        <button type="submit" className="dd-btn is-primary" disabled={!name.trim()} data-testid="block-submit">
          Request block
        </button>
      </div>
    </Frame>
  );
}

function RenameForm({ targetId, x, y }: { targetId: string; x: number; y: number }) {
  const node = useDeck((s) => s.index?.byId.get(targetId));
  const [name, setName] = useState(node?.name ?? '');
  const st = useDeck.getState;
  const submit = () => {
    st().requestRename(targetId, name);
    st().set({ popover: null });
  };
  return (
    <Frame x={x} y={y} onSubmit={submit} testId="rename-form">
      <h4>Rename {node?.kind}</h4>
      {/* biome-ignore lint/a11y/noAutofocus: opened by F2 */}
      <input className="dd-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus onFocus={(e) => e.currentTarget.select()} data-testid="rename-input" />
      <div className="dd-popover-foot">
        <button type="button" className="dd-btn is-ghost" onClick={() => st().set({ popover: null })}>
          Cancel
        </button>
        <button type="submit" className="dd-btn is-primary" disabled={!name.trim()}>
          Request rename
        </button>
      </div>
    </Frame>
  );
}

export function Popovers() {
  const popover = useDeck((s) => s.popover);
  if (!popover) return null;
  if (popover.kind === 'edge') return <EdgeForm key={`${popover.from}${popover.to}`} {...popover} />;
  if (popover.kind === 'block') return <BlockForm key={popover.parentId} {...popover} />;
  return <RenameForm key={popover.targetId} {...popover} />;
}
