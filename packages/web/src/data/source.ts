// Where the deck comes from. The same UI runs against a fixture with no server (M0)
// and against the local decker server.
import type { Change, DeckBundle, DeckLayout, DeckNotes, Id, ReviewBundle, ServerEvent } from '@decker/deck-model';

export type Transition = 'submit' | 'approve' | 'revise' | 'accept' | 'reject' | 'retry' | 'revert';

export interface DeckSource {
  mode: 'fixture' | 'server';
  label: string;
  load(): Promise<DeckBundle>;
  getSource(path: string, ref?: string): Promise<string | null>;
  openInEditor(path: string, line: number): Promise<boolean>;
  saveLayout(layout: DeckLayout): void;
  saveNotes(notes: DeckNotes): void;
  saveChange(change: Change): Promise<Change>;
  discardChange(id: Id): Promise<void>;
  patchPlan(id: Id, patch: unknown): Promise<Change>;
  transition(id: Id, action: Transition, body?: unknown): Promise<Change>;
  review(id: Id): Promise<ReviewBundle>;
  runChecks(): Promise<void>;
  confirmRename(id: Id): Promise<void>;
  subscribe(handler: (event: ServerEvent) => void): () => void;
}

function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

const store = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage can be full or blocked; the map still works for this session.
    }
  },
};

class FixtureSource implements DeckSource {
  mode = 'fixture' as const;
  label: string;
  private name: string;
  private bundle: DeckBundle | null = null;

  constructor(name: string) {
    this.name = name;
    this.label = `fixture: ${name}`;
  }

  private key(part: string): string {
    return `dd:${this.name}:${part}`;
  }

  async load(): Promise<DeckBundle> {
    const res = await fetch(`${import.meta.env.BASE_URL}fixtures/${this.name}.graph.json`);
    if (!res.ok) throw new Error(`Fixture "${this.name}" was not found. Run "npm run fixtures".`);
    const bundle = (await res.json()) as DeckBundle;
    bundle.layout = store.get<DeckLayout>(this.key('layout')) ?? bundle.layout;
    bundle.notes = store.get<DeckNotes>(this.key('notes')) ?? bundle.notes;
    bundle.changes = store.get<Change[]>(this.key('changes')) ?? bundle.changes;
    this.bundle = bundle;
    return bundle;
  }

  async getSource(path: string): Promise<string | null> {
    return this.bundle?.sources?.[path] ?? null;
  }

  async openInEditor(): Promise<boolean> {
    return false;
  }

  saveLayout = debounce((layout: DeckLayout) => store.set(this.key('layout'), layout), 250);
  saveNotes = (notes: DeckNotes) => store.set(this.key('notes'), notes);

  async saveChange(change: Change): Promise<Change> {
    const all = (store.get<Change[]>(this.key('changes')) ?? []).filter((c) => c.id !== change.id);
    store.set(this.key('changes'), [...all, change]);
    return change;
  }

  async discardChange(id: Id): Promise<void> {
    store.set(this.key('changes'), (store.get<Change[]>(this.key('changes')) ?? []).filter((c) => c.id !== id));
  }

  async patchPlan(): Promise<Change> {
    throw new Error('Plans need a connected repository.');
  }

  async transition(): Promise<Change> {
    throw new Error('This map is a fixture. Run "decker <path-to-repo>" to send changes to an agent.');
  }

  async review(): Promise<ReviewBundle> {
    throw new Error('Review needs a connected repository.');
  }

  async runChecks(): Promise<void> {
    throw new Error('Checks need a connected repository.');
  }

  async confirmRename(): Promise<void> {}

  subscribe(): () => void {
    return () => {};
  }
}

class ServerSource implements DeckSource {
  mode = 'server' as const;
  label = 'server';
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(path, {
      ...init,
      headers: { authorization: `Bearer ${this.token}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
    });
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        // not JSON
      }
      throw new Error(message);
    }
    return (await res.json()) as T;
  }

  load(): Promise<DeckBundle> {
    return this.api<DeckBundle>('/api/deck');
  }

  async getSource(path: string, ref?: string): Promise<string | null> {
    try {
      const q = new URLSearchParams({ path, ...(ref ? { ref } : {}) });
      const out = await this.api<{ text: string }>(`/api/source?${q}`);
      return out.text;
    } catch {
      return null;
    }
  }

  async openInEditor(path: string, line: number): Promise<boolean> {
    try {
      await this.api('/api/open-in-editor', { method: 'POST', body: JSON.stringify({ path, line }) });
      return true;
    } catch {
      return false;
    }
  }

  saveLayout = debounce((layout: DeckLayout) => {
    void this.api('/api/layout', { method: 'PATCH', body: JSON.stringify(layout) }).catch(() => {});
  }, 300);

  saveNotes = (notes: DeckNotes) => {
    void this.api('/api/notes', { method: 'PATCH', body: JSON.stringify(notes) }).catch(() => {});
  };

  saveChange(change: Change): Promise<Change> {
    return this.api<Change>(`/api/changes/${change.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: change.title, operations: change.operations }),
    });
  }

  async discardChange(id: Id): Promise<void> {
    await this.api(`/api/changes/${id}`, { method: 'DELETE' });
  }

  patchPlan(id: Id, patch: unknown): Promise<Change> {
    return this.api<Change>(`/api/changes/${id}/plan`, { method: 'PATCH', body: JSON.stringify(patch) });
  }

  transition(id: Id, action: Transition, body?: unknown): Promise<Change> {
    return this.api<Change>(`/api/changes/${id}/${action}`, { method: 'POST', body: JSON.stringify(body ?? {}) });
  }

  review(id: Id): Promise<ReviewBundle> {
    return this.api<ReviewBundle>(`/api/changes/${id}/review`);
  }

  async runChecks(): Promise<void> {
    await this.api('/api/checks', { method: 'POST', body: '{}' });
  }

  async confirmRename(id: Id): Promise<void> {
    await this.api('/api/identity/confirm', { method: 'POST', body: JSON.stringify({ id }) });
  }

  subscribe(handler: (event: ServerEvent) => void): () => void {
    let closed = false;
    let socket: WebSocket | null = null;
    let retry = 500;
    const connect = () => {
      if (closed) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${proto}://${location.host}/api/events`, ['decker', `t.${this.token}`]);
      socket.onopen = () => {
        retry = 500;
      };
      socket.onmessage = (m) => {
        try {
          handler(JSON.parse(String(m.data)) as ServerEvent);
        } catch {
          // ignore malformed frames
        }
      };
      socket.onclose = () => {
        if (closed) return;
        setTimeout(connect, retry);
        retry = Math.min(retry * 2, 8000);
      };
    };
    connect();
    return () => {
      closed = true;
      socket?.close();
    };
  }
}

/** Pick the source: an explicit ?fixture=, else the local server, else the shop fixture. */
export async function connect(): Promise<DeckSource> {
  const url = new URL(location.href);
  const fixture = url.searchParams.get('fixture');
  if (fixture) return new FixtureSource(fixture);

  let token = url.searchParams.get('t');
  if (token) {
    sessionStorage.setItem('dd:token', token);
    url.searchParams.delete('t');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  } else token = sessionStorage.getItem('dd:token');

  if (token) {
    try {
      const res = await fetch('/api/ping', { headers: { authorization: `Bearer ${token}` } });
      if (res.ok) return new ServerSource(token);
    } catch {
      // no server: fall through to the fixture
    }
  }
  return new FixtureSource('shop');
}
