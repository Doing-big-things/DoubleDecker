import {
  ChevronRight,
  CircleHelp,
  FlaskConical,
  GitPullRequestDraft,
  LayoutGrid,
  ListTree,
  Moon,
  Play,
  Search,
  Sun,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { crumbsFor, isOpen, useDeck } from '../state/store';

export function TopBar() {
  const crumbs = useDeck(useShallow(crumbsFor));
  const theme = useDeck((s) => s.theme);
  const stats = useDeck((s) => s.bundle?.snapshot.stats);
  const dirty = useDeck((s) => s.bundle?.snapshot.dirty ?? false);
  const caps = useDeck((s) => s.bundle?.capabilities);
  const mode = useDeck((s) => s.source?.mode);
  const pending = useDeck((s) =>
    s.changes.filter(isOpen).reduce((n, c) => n + Math.max(1, c.operations.length), 0),
  );
  const trayOpen = useDeck((s) => s.trayOpen);
  const outlineOpen = useDeck((s) => s.outlineOpen);
  const allTests = useDeck((s) => s.allTests);
  const checksRunning = useDeck((s) => s.checksRunning);
  const st = useDeck.getState;

  const total = stats ? stats.callSites + stats.imports : 0;
  const resolved = stats ? stats.resolvedCallSites + stats.resolvedImports : 0;
  const pct = total ? Math.floor((resolved / total) * 100) : 100;

  return (
    <header className="dd-top">
      <button
        type="button"
        className="dd-icon-btn"
        aria-label="Outline"
        title="Outline view  (Ctrl+\)"
        data-testid="outline-toggle"
        onClick={() => st().set({ outlineOpen: !outlineOpen })}
      >
        <ListTree size={16} />
      </button>
      <div className="dd-logo" aria-hidden="true">
        <i />
        <i />
      </div>
      <nav className="dd-crumbs" aria-label="Breadcrumb" data-testid="breadcrumb">
        {crumbs.map((node, i) => (
          <span key={node.id} style={{ display: 'contents' }}>
            {i > 0 ? <ChevronRight size={13} className="dd-crumb-sep" /> : null}
            <button
              type="button"
              className="dd-crumb"
              onClick={() => {
                if (node.kind === 'system') {
                  st().select(null);
                  st().escape();
                } else st().select(node.id, { fly: true });
              }}
            >
              {node.name}
            </button>
          </span>
        ))}
      </nav>
      {mode === 'fixture' ? (
        <span
          className="dd-tag"
          title="This map is a hand-written fixture, not extracted code"
          style={{ fontSize: 11 }}
        >
          fixture
        </span>
      ) : null}
      {dirty ? (
        <span className="dd-tag" title="The working tree has uncommitted changes" style={{ fontSize: 11 }}>
          uncommitted
        </span>
      ) : null}

      <button
        type="button"
        className="dd-search"
        onClick={() => st().set({ paletteOpen: true })}
        data-testid="search"
      >
        <Search size={14} />
        Search blocks, operations, tests…
        <span className="dd-kbd">Ctrl K</span>
      </button>

      {stats ? (
        <span
          className="dd-coverage"
          data-testid="coverage"
          title={`${resolved} of ${total} call sites and imports resolved. The map is only as trustworthy as this number.`}
        >
          <i>
            <b style={{ width: `${pct}%` }} />
          </i>
          {pct}% resolved
        </span>
      ) : null}

      {caps?.server ? (
        <button
          type="button"
          className="dd-btn is-ghost"
          disabled={checksRunning || caps.sandbox === 'none'}
          title={
            caps.sandbox === 'none'
              ? 'Running tests needs Docker or Podman (or --sandbox=host)'
              : 'Run the checks on the current tree'
          }
          data-testid="run-checks"
          onClick={() => void st().runChecks()}
        >
          {checksRunning ? <span className="dd-spin" /> : <Play size={13} />}{' '}
          {checksRunning ? 'Checking…' : 'Run checks'}
        </button>
      ) : null}
      <button
        type="button"
        className={`dd-icon-btn${allTests ? ' is-on' : ''}`}
        style={allTests ? { color: 'var(--accent)' } : undefined}
        aria-label="All tests"
        aria-pressed={allTests}
        title="Open every tests drawer  (Shift+T)"
        data-testid="all-tests"
        onClick={() => st().toggleAllTests()}
      >
        <FlaskConical size={15} />
      </button>
      <button
        type="button"
        className="dd-icon-btn"
        aria-label="Tidy up"
        title="Tidy up: lay the map out again"
        data-testid="tidy"
        onClick={() => void st().tidy()}
      >
        <LayoutGrid size={15} />
      </button>
      <button
        type="button"
        className={`dd-btn${trayOpen ? ' is-on' : ''}`}
        data-testid="changes"
        onClick={() => st().set({ trayOpen: !trayOpen })}
      >
        <GitPullRequestDraft size={14} /> Changes{' '}
        {pending > 0 ? (
          <span className="dd-count" data-testid="changes-count">
            {pending}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        className="dd-icon-btn"
        aria-label="Toggle theme"
        title="Light or dark"
        data-testid="theme"
        onClick={() => st().setTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      </button>
      <button
        type="button"
        className="dd-icon-btn"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts  (?)"
        onClick={() => st().set({ helpOpen: true })}
      >
        <CircleHelp size={15} />
      </button>
    </header>
  );
}
