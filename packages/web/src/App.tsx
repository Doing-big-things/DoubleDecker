import { useEffect, useState } from 'react';
import { ChangeTray } from './chrome/ChangeTray';
import { Outline } from './chrome/Outline';
import { Palette } from './chrome/Palette';
import { TopBar } from './chrome/TopBar';
import { Popovers } from './edit/Popovers';
import { useKeys } from './lib/keys';
import { FlowMap } from './map/FlowMap';
import { DetailPanel } from './panel/DetailPanel';
import { ReviewBanner } from './panel/ReviewPanel';
import { useDeck } from './state/store';

const SHORTCUTS: [string, string][] = [
  ['Pan', 'Drag the canvas · Shift + arrows'],
  ['Zoom at the cursor', 'Wheel or pinch · + / −'],
  ['Fit everything', '0'],
  ['Focus the selection', 'Double-click · F'],
  ['Move to a neighbor', 'Arrows'],
  ['Expand or collapse', 'Enter'],
  ["Open a block's tests", 'T'],
  ['Open all tests', 'Shift + T'],
  ['Up one level', 'Esc'],
  ['Search and fly', 'Ctrl + K'],
  ['Camera back / forward', 'Alt + ← / →'],
  ['Outline view', 'Ctrl + \\'],
  ['Open in editor', 'Ctrl + Enter'],
  ['New block', 'N · double-click an area'],
  ['New arrow', 'Drag from a block’s edge'],
  ['Change a bullet', 'Click it and type'],
  ['Rename', 'F2'],
  ['Request removal', 'Delete'],
  ['Undo / redo', 'Ctrl + Z / Ctrl + Shift + Z'],
  ['Before the change (review)', 'Hold B'],
];

function Help() {
  const open = useDeck((s) => s.helpOpen);
  if (!open) return null;
  return (
    <>
      <div className="dd-overlay" onClick={() => useDeck.getState().set({ helpOpen: false })} />
      <div className="dd-help" role="dialog" aria-label="Keyboard shortcuts" data-testid="help">
        <h3>Keyboard and mouse</h3>
        <div className="dd-help-grid">
          {SHORTCUTS.map(([what, keys]) => (
            <div key={what}>
              <span>{what}</span>
              <span style={{ color: 'var(--text)', textAlign: 'right' }}>{keys}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Renames() {
  const renames = useDeck((s) => s.bundle?.renames);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const open = (renames ?? []).filter((r) => !dismissed.includes(r.id + r.to));
  if (open.length === 0) return null;
  const short = (key: string) => key.split('#').at(-1) ?? key;
  return (
    <div className="dd-banner" style={{ top: 'auto', bottom: 14, borderColor: 'var(--line-strong)', flexDirection: 'column', alignItems: 'stretch' }} data-testid="renames">
      {open.map((r) => (
        <div key={r.id + r.to} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="t">
            <b className="mono">{short(r.from)}</b> looks renamed to <b className="mono">{short(r.to)}</b>. Keep its position, notes and history?
          </span>
          <button type="button" className="dd-btn is-primary" data-testid="rename-confirm" onClick={() => void useDeck.getState().source?.confirmRename(r.id)}>
            It is the same
          </button>
          <button type="button" className="dd-btn is-ghost" onClick={() => setDismissed([...dismissed, r.id + r.to])}>
            It is new
          </button>
        </div>
      ))}
    </div>
  );
}

function Toasts() {
  const toasts = useDeck((s) => s.toasts);
  return (
    <div className="dd-toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`dd-toast${t.error ? ' is-error' : ''}`} data-testid="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function App() {
  const status = useDeck((s) => s.status);
  const error = useDeck((s) => s.error);
  useKeys();
  useEffect(() => {
    void useDeck.getState().init();
  }, []);

  return (
    <div className="dd-app" data-status={status} data-testid="app">
      <TopBar />
      <div className="dd-main">
        <div className="dd-stage">
          {status === 'error' ? (
            <div className="dd-loading" style={{ pointerEvents: 'auto' }}>
              <div style={{ maxWidth: 460, textAlign: 'center' }}>
                <b style={{ color: 'var(--text)' }}>The deck could not be loaded.</b>
                <div style={{ marginTop: 6 }}>{error}</div>
              </div>
            </div>
          ) : (
            <FlowMap />
          )}
          <Outline />
          <ReviewBanner />
          <Renames />
          <ChangeTray />
        </div>
        <DetailPanel />
      </div>
      <Palette />
      <Popovers />
      <Help />
      <Toasts />
    </div>
  );
}
