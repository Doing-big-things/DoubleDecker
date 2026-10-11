// Read-only, syntax-highlighted source (spec §3.6 step 4) and the diff view used in review.
import type { FileDiff } from '@decker/deck-model';
import { ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { openSelectedInEditor } from '../lib/keys';
import { type Peek, useDeck } from '../state/store';

type Token = { content: string; htmlStyle?: Record<string, string>; color?: string };
type Highlighter = { codeToTokens(code: string, options: unknown): { tokens: Token[][] } };

let highlighter: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([import('shiki/core'), import('shiki/engine/javascript')]);
    return (await createHighlighterCore({
      themes: [import('@shikijs/themes/github-dark-default'), import('@shikijs/themes/github-light-default')],
      langs: [import('@shikijs/langs/typescript'), import('@shikijs/langs/tsx'), import('@shikijs/langs/javascript'), import('@shikijs/langs/json')],
      engine: createJavaScriptRegexEngine(),
    })) as unknown as Highlighter;
  })();
  return highlighter;
}

function langOf(path: string): string {
  if (path.endsWith('.tsx') || path.endsWith('.jsx')) return 'tsx';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) return 'javascript';
  return 'typescript';
}

function Line({ tokens, theme }: { tokens: Token[]; theme: 'dark' | 'light' }) {
  return (
    <span>
      {tokens.map((t, i) => (
        <span key={i} style={{ color: t.htmlStyle?.[`--shiki-${theme}`] ?? t.color }}>
          {t.content}
        </span>
      ))}
    </span>
  );
}

export function CodePeek({ peek }: { peek: Peek }) {
  const source = useDeck((s) => s.source);
  const theme = useDeck((s) => s.theme);
  const treeHash = useDeck((s) => s.bundle?.treeHash);
  const [text, setText] = useState<string | null | undefined>(undefined);
  const [tokens, setTokens] = useState<Token[][] | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch when the working tree changes
  useEffect(() => {
    let live = true;
    setTokens(null);
    void source?.getSource(peek.path).then((t) => {
      if (!live) return;
      setText(t);
      if (t === null) return;
      void getHighlighter()
        .then((h) => {
          if (live) setTokens(h.codeToTokens(t, { lang: langOf(peek.path), themes: { dark: 'github-dark-default', light: 'github-light-default' }, defaultColor: false }).tokens);
        })
        .catch(() => {});
    });
    return () => {
      live = false;
    };
  }, [source, peek.path, treeHash]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll again once the text has arrived
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(`[data-line="${peek.startLine}"]`);
    if (el && box.current) box.current.scrollTop = Math.max(0, el.offsetTop - box.current.offsetTop - 48);
  }, [peek.startLine, peek.path, text, tokens]);

  const lines = text?.split('\n') ?? [];
  return (
    <div data-testid="code-peek">
      <div className="dd-path">
        <span title={`${peek.path}:${peek.startLine}`}>
          {peek.path}:{peek.startLine}
        </span>
        <button type="button" className="dd-btn" style={{ height: 24, marginLeft: 'auto' }} onClick={openSelectedInEditor} title="Open in editor  (Ctrl+Enter)" data-testid="open-editor">
          <ExternalLink size={12} /> Open
        </button>
      </div>
      {text === undefined ? <div className="dd-empty">Loading source…</div> : null}
      {text === null ? <div className="dd-empty">The source for this item is not available.</div> : null}
      {text ? (
        <div className="dd-code" ref={box}>
          {lines.map((line, i) => {
            const n = i + 1;
            const hl = n >= peek.startLine && n <= peek.endLine;
            return (
              <div className={`dd-code-line${hl ? ' is-hl' : ''}`} key={n} data-line={n}>
                <i>{n}</i>
                {tokens?.[i] ? <Line tokens={tokens[i]!} theme={theme} /> : <span>{line}</span>}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function DiffView({ files }: { files: FileDiff[] }) {
  if (files.length === 0) return <div className="dd-empty">No code differs here.</div>;
  return (
    <div data-testid="diff">
      {files.map((file) => (
        <div key={file.path}>
          <div className="dd-path">
            <span>{file.path}</span>
            <span style={{ marginLeft: 'auto', direction: 'ltr' }}>{file.status}</span>
          </div>
          <div className="dd-code">
            {file.patch.split('\n').map((line, i) => {
              const kind = line.startsWith('@@') ? ' is-hunk' : line.startsWith('+') ? ' is-add' : line.startsWith('-') ? ' is-del' : '';
              return (
                <div className={`dd-code-line${kind}`} key={i}>
                  <i>{line[0] === '+' || line[0] === '-' ? line[0] : ''}</i>
                  <span>{line.startsWith('@@') ? line : line.slice(1)}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
