// Search and fly (Ctrl+K).
import { type DeckIndex, type Id, cardBullets, pathTo } from '@decker/deck-model';
import { Command } from 'cmdk';
import { useMemo, useState } from 'react';
import { camera } from '../map/camera';
import { useDeck } from '../state/store';

interface Entry {
  id: Id;
  kind: 'area' | 'block' | 'operation' | 'behavior' | 'test';
  name: string;
  sub?: string;
  where: string;
  hay: string;
  target: Id;
  op?: Id;
}

const WEIGHT = { block: 0, area: 0.5, operation: 1, behavior: 2, test: 3 };
const cache = new WeakMap<DeckIndex, Entry[]>();

function entriesOf(index: DeckIndex): Entry[] {
  const hit = cache.get(index);
  if (hit) return hit;
  const out: Entry[] = [];
  const where = (id: Id) =>
    pathTo(index, id)
      .slice(1, -1)
      .map((n) => n.name)
      .join(' ▸ ');
  for (const area of index.areas) out.push({ id: area.id, kind: 'area', name: area.name, where: where(area.id), hay: area.name.toLowerCase(), target: area.id });
  for (const block of index.blocks) {
    const w = where(block.id);
    out.push({ id: block.id, kind: 'block', name: block.name, sub: block.summary?.text, where: w, hay: `${block.name} ${block.summary?.text ?? ''} ${block.source[0]?.path ?? ''}`.toLowerCase(), target: block.id });
    for (const b of cardBullets(index, block.id)) {
      const op = b.opId ? index.byId.get(b.opId) : undefined;
      if (op) out.push({ id: op.id, kind: 'operation', name: op.name, sub: b.bullet.text, where: `${w} ▸ ${block.name}`, hay: `${op.name} ${b.bullet.text}`.toLowerCase(), target: block.id, op: op.id });
      else out.push({ id: b.bullet.id, kind: 'behavior', name: b.bullet.text, where: `${w} ▸ ${block.name}`, hay: b.bullet.text.toLowerCase(), target: block.id });
    }
  }
  for (const test of index.snapshot.tests) {
    const target = test.targets[0];
    const block = target ? index.blockOf.get(target.id) : undefined;
    if (!block) continue;
    out.push({ id: test.id, kind: 'test', name: test.name, where: index.byId.get(block)?.name ?? '', hay: test.name.toLowerCase(), target: block, op: target!.id === block ? undefined : target!.id });
  }
  cache.set(index, out);
  return out;
}

function search(entries: Entry[], query: string): Entry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored: { e: Entry; score: number }[] = [];
  for (const e of entries) {
    if (!words.every((w) => e.hay.includes(w))) continue;
    const name = e.name.toLowerCase();
    const first = words[0]!;
    const score = (name === first ? 0 : name.startsWith(first) ? 1 : name.includes(first) ? 2 : 3) * 4 + WEIGHT[e.kind];
    scored.push({ e, score });
  }
  scored.sort((a, b) => a.score - b.score || a.e.name.length - b.e.name.length);
  return scored.slice(0, 40).map((s) => s.e);
}

export function Palette() {
  const open = useDeck((s) => s.paletteOpen);
  const index = useDeck((s) => s.index);
  const [query, setQuery] = useState('');
  const entries = useMemo(() => (index ? entriesOf(index) : []), [index]);
  const results = useMemo(() => search(entries, query), [entries, query]);
  if (!open || !index) return null;
  const st = useDeck.getState;
  const close = () => {
    st().set({ paletteOpen: false });
    setQuery('');
  };
  const commands: { name: string; keys?: string; run: () => void }[] = [
    { name: 'Fit everything', keys: '0', run: () => camera.fit() },
    { name: 'Tidy up the layout', run: () => void st().tidy() },
    { name: 'Open every tests drawer', keys: 'Shift T', run: () => st().toggleAllTests() },
    { name: 'Toggle the outline', keys: 'Ctrl \\', run: () => st().set({ outlineOpen: !st().outlineOpen }) },
    { name: 'Switch between dark and light', run: () => st().setTheme(st().theme === 'dark' ? 'light' : 'dark') },
    { name: 'Show the change tray', run: () => st().set({ trayOpen: true }) },
    { name: 'Keyboard shortcuts', keys: '?', run: () => st().set({ helpOpen: true }) },
  ];
  const q = query.toLowerCase();
  const shownCommands = query ? commands.filter((c) => c.name.toLowerCase().includes(q)) : commands;
  const top = (index.children.get(index.system.id) ?? []).filter((n) => n.kind === 'area');

  return (
    <>
      <div className="dd-overlay" onClick={close} />
      <Command className="dd-palette" shouldFilter={false} label="Search the deck" data-testid="palette">
        <Command.Input value={query} onValueChange={setQuery} placeholder="Search blocks, operations, behavior, tests…" autoFocus />
        <Command.List>
          <Command.Empty>Nothing on the deck matches “{query}”.</Command.Empty>
          {results.length ? (
            <Command.Group heading="On the deck">
              {results.map((e) => (
                <Command.Item
                  key={`${e.kind}:${e.id}`}
                  value={`${e.kind}:${e.id}`}
                  data-testid="palette-item"
                  onSelect={() => {
                    close();
                    st().select(e.target, { fly: true, op: e.op ?? null });
                    if (e.kind === 'test') st().set({ panelTab: 'tests' });
                  }}
                >
                  <span className="dd-pal-kind">{e.kind}</span>
                  <span className="dd-pal-main">
                    {e.name}
                    {e.sub ? <span>{e.sub}</span> : null}
                  </span>
                  <span className="dd-pal-where">{e.where}</span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}
          {!query ? (
            <Command.Group heading="Areas">
              {top.map((a) => (
                <Command.Item
                  key={a.id}
                  value={`area:${a.id}`}
                  onSelect={() => {
                    close();
                    st().select(a.id, { fly: true });
                  }}
                >
                  <span className="dd-pal-kind">area</span>
                  <span className="dd-pal-main">{a.name}</span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}
          {shownCommands.length ? (
            <Command.Group heading="Commands">
              {shownCommands.map((c) => (
                <Command.Item
                  key={c.name}
                  value={`cmd:${c.name}`}
                  onSelect={() => {
                    close();
                    c.run();
                  }}
                >
                  <span className="dd-pal-kind">do</span>
                  <span className="dd-pal-main">{c.name}</span>
                  {c.keys ? <span className="dd-kbd">{c.keys}</span> : null}
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}
        </Command.List>
      </Command>
    </>
  );
}
