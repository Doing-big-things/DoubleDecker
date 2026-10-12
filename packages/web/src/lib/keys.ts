// Keyboard map (spec §3.5). Everything on the canvas is reachable without a mouse.
import type { Id } from '@decker/deck-model';
import { useEffect } from 'react';
import { camera, levelOf } from '../map/camera';
import { linkOf } from '../map/LinkEdge';
import { useDeck } from '../state/store';

type Dir = 'left' | 'right' | 'up' | 'down';

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
  );
}

/** Move the selection to the nearest neighbor in a direction. */
function navigate(dir: Dir): void {
  const st = useDeck.getState();
  const index = st.index;
  if (!index) return;
  const kind = levelOf(st.band) === 'system' ? 'area' : 'block';
  const candidates = (
    st.view === 'simple' ? (st.simple?.parts ?? []) : kind === 'area' ? index.areas : index.blocks
  )
    .map((n) => camera.box(n.id))
    .filter((b) => b !== undefined);
  if (candidates.length === 0) return;
  const cur = st.selectedId ? camera.box(st.selectedId) : undefined;
  const origin = cur ? { x: cur.ax + cur.w / 2, y: cur.ay + cur.h / 2 } : camera.center();
  let best: Id | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const box of candidates) {
    if (box.id === st.selectedId) continue;
    const dx = box.ax + box.w / 2 - origin.x;
    const dy = box.ay + box.h / 2 - origin.y;
    const along = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (!cur && Math.hypot(dx, dy) < bestScore) {
      best = box.id;
      bestScore = Math.hypot(dx, dy);
      continue;
    }
    if (!cur || along < 12) continue;
    const score = along + across * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = box.id;
    }
  }
  if (best) {
    st.select(best);
    camera.reveal(best);
  }
}

export function openSelectedInEditor(): void {
  const st = useDeck.getState();
  const index = st.index;
  if (!index || !st.selectedId) return;
  const node = index.byId.get(st.focusOpId ?? st.selectedId);
  const ref =
    st.peek ?? (node?.source[0] ? { path: node.source[0].path, startLine: node.source[0].startLine } : null);
  if (!ref) return;
  void st.source?.openInEditor(ref.path, ref.startLine).then((ok) => {
    st.toast(
      ok ? `Opened ${ref.path}:${ref.startLine}` : 'Opening an editor needs a connected repository',
      !ok,
    );
  });
}

export function removeSelected(): void {
  const st = useDeck.getState();
  const index = st.index;
  const id = st.selectedId;
  if (!index || !id) return;
  const link = linkOf(index, id);
  if (link) {
    if (link.id.startsWith('aln:')) return;
    const requested = link.edges.filter((e) => st.marks.get(e.id)?.state === 'requested');
    if (requested.length === link.edges.length) for (const e of requested) st.requestRemove(e.id, 'edge', '');
    else
      st.requestRemove(
        id,
        'edge',
        `the arrow ${index.byId.get(link.from)?.name} → ${index.byId.get(link.to)?.name}`,
      );
    return;
  }
  const node = index.byId.get(st.focusOpId ?? id);
  if (!node || node.kind === 'area' || node.kind === 'system') return;
  st.requestRemove(node.id, 'node', `${node.kind} ${node.name}`);
}

export function startRename(): void {
  const st = useDeck.getState();
  const id = st.focusOpId ?? st.selectedId;
  const node = id ? st.index?.byId.get(id) : undefined;
  if (!node || node.kind === 'system' || node.kind === 'area') return;
  const box = camera.box(st.selectedId!);
  const vp = camera.viewport();
  const stage = document.querySelector('.dd-stage')?.getBoundingClientRect();
  if (node.kind === 'block' && levelOf(st.band) === 'blocks') {
    st.set({ editing: `name:${node.id}` });
    return;
  }
  st.set({
    popover: {
      kind: 'rename',
      targetId: node.id,
      x: (stage?.left ?? 0) + (box ? box.ax * vp.zoom + vp.x : 200),
      y: (stage?.top ?? 0) + (box ? box.ay * vp.zoom + vp.y : 200),
    },
  });
}

export function newBlock(): void {
  const st = useDeck.getState();
  const index = st.index;
  if (!index) return;
  const sel = st.selectedId ? index.byId.get(st.selectedId) : undefined;
  let parentId: Id | undefined =
    sel?.kind === 'area' ? sel.id : sel?.kind === 'block' ? (sel.parentId ?? undefined) : undefined;
  if (!parentId) {
    // The innermost area under the middle of the screen.
    const c = camera.center();
    let depth = -1;
    for (const area of index.areas) {
      const box = camera.box(area.id);
      if (
        box &&
        c.x >= box.ax &&
        c.x <= box.ax + box.w &&
        c.y >= box.ay &&
        c.y <= box.ay + box.h &&
        box.depth > depth
      ) {
        depth = box.depth;
        parentId = area.id;
      }
    }
  }
  parentId ??= index.areas[0]?.id ?? index.system.id;
  const stage = document.querySelector('.dd-stage')?.getBoundingClientRect();
  st.set({
    popover: {
      kind: 'block',
      parentId,
      x: (stage?.left ?? 0) + (stage?.width ?? 800) / 2 - 160,
      y: (stage?.top ?? 0) + 120,
    },
  });
}

export function useKeys(): void {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const st = useDeck.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key;

      if (mod && key.toLowerCase() === 'k') {
        e.preventDefault();
        return st.set({ paletteOpen: !st.paletteOpen });
      }
      if (key === 'Escape') {
        if (typing(e.target) && !st.paletteOpen) (e.target as HTMLElement).blur();
        e.preventDefault();
        return st.escape();
      }
      if (typing(e.target) || st.paletteOpen || st.popover) return;

      if (mod && key === '\\') {
        e.preventDefault();
        return st.set({ outlineOpen: !st.outlineOpen });
      }
      if (mod && key.toLowerCase() === 'z') {
        e.preventDefault();
        return e.shiftKey ? st.redo() : st.undo();
      }
      if (mod && key.toLowerCase() === 'y') {
        e.preventDefault();
        return st.redo();
      }
      if (mod && key === 'Enter') {
        e.preventDefault();
        return openSelectedInEditor();
      }
      if (e.altKey && key === 'ArrowLeft') {
        e.preventDefault();
        return st.back();
      }
      if (e.altKey && key === 'ArrowRight') {
        e.preventDefault();
        return st.forward();
      }
      if (mod || e.altKey) return;

      if (key === 's' || key === 'S') return st.setView(st.view === 'simple' ? 'advanced' : 'simple');
      // The simple view has no cards to expand, tests drawers, renames or removals: its keys
      // are moving about, opening a part, and asking for something.
      if (st.view === 'simple') {
        const part = st.selectedId ? st.simple?.partById.get(st.selectedId) : undefined;
        if (key === 'Enter' && part) {
          e.preventDefault();
          return st.setView('advanced', { focus: part.id });
        }
        if ((key === 'n' || key === 'N') && part) {
          e.preventDefault();
          return st.set({ asking: part.id });
        }
        if (['Enter', 't', 'T', 'n', 'N', 'F2', 'Delete', 'Backspace'].includes(key)) return;
      }

      const arrows: Record<string, Dir> = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'up',
        ArrowDown: 'down',
      };
      if (arrows[key]) {
        e.preventDefault();
        if (e.shiftKey) {
          const step = 120;
          return camera.panBy(
            key === 'ArrowLeft' ? step : key === 'ArrowRight' ? -step : 0,
            key === 'ArrowUp' ? step : key === 'ArrowDown' ? -step : 0,
          );
        }
        return navigate(arrows[key]);
      }
      switch (key) {
        case '+':
        case '=':
          return camera.zoomBy(1.3);
        case '-':
        case '_':
          return camera.zoomBy(1 / 1.3);
        case '0':
          camera.record(st.selectedId);
          return camera.fit();
        case 'f':
        case 'F':
          if (st.selectedId) {
            camera.record(st.selectedId);
            const link =
              st.simple?.linkById.get(st.selectedId) ??
              (st.index ? linkOf(st.index, st.selectedId) : undefined);
            camera.flyTo(link ? [link.from, link.to] : st.selectedId);
          }
          return;
        case 'Enter':
          e.preventDefault();
          return st.toggleExpand();
        case 't':
          return st.toggleTests();
        case 'T':
          return st.toggleAllTests();
        case 'n':
        case 'N':
          e.preventDefault();
          return newBlock();
        case 'F2':
          e.preventDefault();
          return startRename();
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          return removeSelected();
        case 'b':
        case 'B':
          return st.setShowBefore(true);
        case '?':
          return st.set({ helpOpen: !st.helpOpen });
        case '/':
          e.preventDefault();
          return st.set({ paletteOpen: true });
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'b' || e.key === 'B') useDeck.getState().setShowBefore(false);
    };
    const pop = () => {
      const m = location.hash.match(/^#\/(?:block|area|arrow|operation)\/(.+)$/);
      const id = m ? decodeURIComponent(m[1]!) : null;
      useDeck.getState().select(id, { fly: Boolean(id), silent: true });
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('popstate', pop);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('popstate', pop);
    };
  }, []);
}
