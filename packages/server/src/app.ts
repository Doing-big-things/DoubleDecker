// The local server (spec §8.3, §8.4): one Node process on the engineer's machine.
// It binds to 127.0.0.1 only, requires a per-session token, checks the Origin header,
// and confines file access to the repository root.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StateError } from '@decker/core';
import { changePatchSchema } from '@decker/deck-model';
import { serve } from '@hono/node-server';
import { type Context, Hono } from 'hono';
import { WebSocketServer } from 'ws';
import { DeckService, type ServiceOptions } from './deck-service.ts';

export interface ServerOptions extends ServiceOptions {
  root: string;
  port?: number;
  token?: string;
  /** Extra origins allowed to call the API, such as a Vite dev server. */
  allowOrigins?: string[];
}

export interface RunningServer {
  url: string;
  port: number;
  token: string;
  service: DeckService;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const token = options.token ?? randomBytes(18).toString('base64url');
  const service = new DeckService(options.root, options);
  await service.init(options);

  let port = options.port ?? 4747;
  const allowed = () => new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...(options.allowOrigins ?? [])]);
  const app = new Hono();

  app.use('/api/*', async (c, next) => {
    const origin = c.req.header('origin');
    if (origin && !allowed().has(origin)) return c.json({ error: 'This origin may not use the deck.' }, 403);
    const header = c.req.header('authorization') ?? '';
    if (!header.startsWith('Bearer ') || !same(header.slice(7), token)) return c.json({ error: 'A session token is required.' }, 401);
    await next();
  });

  const fail = (c: Context, err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, err instanceof StateError ? 409 : 400);
  };
  const body = async (c: Context): Promise<Record<string, unknown>> => {
    try {
      return (await c.req.json()) as Record<string, unknown>;
    } catch {
      return {};
    }
  };

  app.get('/api/ping', (c) => c.json({ ok: true, name: path.basename(service.root) }));
  app.get('/api/deck', (c) => c.json(service.bundle()));

  app.get('/api/source', (c) => {
    try {
      const text = service.source(c.req.query('path') ?? '', c.req.query('ref'));
      return text === null ? c.json({ error: 'No such file.' }, 404) : c.json({ text });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post('/api/open-in-editor', async (c) => {
    try {
      const b = await body(c);
      service.openInEditor(String(b.path ?? ''), Number(b.line ?? 1));
      return c.json({ ok: true });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.patch('/api/layout', async (c) => {
    try {
      return c.json(service.saveLayout(await body(c)));
    } catch (err) {
      return fail(c, err);
    }
  });

  app.patch('/api/notes', async (c) => {
    try {
      return c.json(service.saveNotes(await body(c)));
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post('/api/checks', (c) => {
    if (service.sandbox === 'none') return c.json({ error: 'Running checks needs Docker or Podman, or --sandbox=host.' }, 409);
    void service.runChecks().catch(() => {});
    return c.json({ ok: true });
  });

  app.get('/api/identity', (c) => c.json({ suggestions: service.renameSuggestions }));
  app.post('/api/identity/confirm', async (c) => {
    try {
      service.confirm(String((await body(c)).id ?? ''));
      return c.json({ ok: true });
    } catch (err) {
      return fail(c, err);
    }
  });

  // Changes: create or edit a draft, then the lifecycle transitions.
  app.post('/api/changes', async (c) => {
    try {
      const b = await body(c);
      return c.json(service.coordinator.upsertDraft(String(b.id ?? ''), changePatchSchema.parse(b)));
    } catch (err) {
      return fail(c, err);
    }
  });
  app.patch('/api/changes/:id', async (c) => {
    try {
      return c.json(service.coordinator.upsertDraft(c.req.param('id'), changePatchSchema.parse(await body(c))));
    } catch (err) {
      return fail(c, err);
    }
  });
  app.delete('/api/changes/:id', (c) => {
    try {
      service.coordinator.discard(c.req.param('id'));
      return c.json({ ok: true });
    } catch (err) {
      return fail(c, err);
    }
  });
  app.patch('/api/changes/:id/plan', async (c) => {
    try {
      return c.json(service.coordinator.patchPlan(c.req.param('id'), await body(c)));
    } catch (err) {
      return fail(c, err);
    }
  });
  app.get('/api/changes/:id/review', (c) => {
    try {
      return c.json(service.coordinator.review(c.req.param('id')));
    } catch (err) {
      return fail(c, err);
    }
  });
  app.post('/api/changes/:id/:action', async (c) => {
    const id = c.req.param('id');
    const co = service.coordinator;
    try {
      switch (c.req.param('action')) {
        case 'submit':
          return c.json(co.submit(id));
        case 'approve':
          return c.json(co.approve(id));
        case 'revise':
          return c.json(co.revise(id, String((await body(c)).comment ?? '')));
        case 'retry':
          return c.json(co.retry(id));
        case 'accept':
          return c.json(await co.accept(id));
        case 'reject':
          return c.json(co.reject(id));
        case 'revert':
          return c.json(co.revert(id));
        default:
          return c.json({ error: 'No such action.' }, 404);
      }
    } catch (err) {
      return fail(c, err);
    }
  });

  // The upper deck itself: the built web app, served as static files.
  app.get('*', (c) => {
    const url = new URL(c.req.url);
    let file = path.resolve(WEB_DIST, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(WEB_DIST)) return c.text('Not found', 404);
    if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(WEB_DIST, 'index.html');
    if (!existsSync(file)) return c.text('The web app is not built. Run "npm run build" in the Double Decker repository.', 503);
    const headers: Record<string, string> = { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' };
    if (file.endsWith('index.html')) headers['cache-control'] = 'no-store';
    return c.body(readFileSync(file), 200, headers);
  });

  const server = await new Promise<Server>((resolve, reject) => {
    const attempt = (p: number, tries: number) => {
      const s = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: p }) as Server;
      s.once('listening', () => {
        port = p;
        resolve(s);
      });
      s.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && tries > 0 && options.port === undefined) attempt(p + 1, tries - 1);
        else reject(err);
      });
    };
    attempt(port, 20);
  });

  // WS /api/events: snapshot patches, change state, agent progress.
  const sockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const protocols = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map((p) => p.trim());
    const offered = protocols.find((p) => p.startsWith('t.'))?.slice(2) ?? '';
    const origin = req.headers.origin;
    if (url.pathname !== '/api/events' || !same(offered, token) || (origin && !allowed().has(origin))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => sockets.emit('connection', ws, req));
  });
  sockets.on('connection', (ws) => {
    const unsubscribe = service.subscribe((event) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
    });
    ws.on('close', unsubscribe);
    ws.on('error', unsubscribe);
  });

  return {
    url: `http://127.0.0.1:${port}/?t=${token}`,
    port,
    token,
    service,
    async close() {
      for (const ws of sockets.clients) ws.terminate();
      sockets.close();
      await service.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
