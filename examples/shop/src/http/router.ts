import { ShopError } from '../shared/errors';

export interface Request {
  params: Record<string, string>;
  body: unknown;
}

export interface Response {
  status: number;
  body: unknown;
}

export type Handler = (req: Request) => unknown;

const STATUS: Record<ShopError['code'], number> = { not_found: 404, invalid: 422, conflict: 409 };

/** Matches requests to route handlers. */
export class Router {
  // Handlers are looked up by a string key built at run time, so the map cannot follow
  // dispatch() into them. Double Decker shows this as an opaque marker on the block.
  private handlers: Record<string, Handler> = {};

  /** Register a handler for a method and path, such as "GET /orders/:id". */
  add(route: string, handler: Handler): void {
    if (this.handlers[route]) throw new Error(`Route ${route} is already registered`);
    this.handlers[route] = handler;
  }

  /** Find the handler for a request and run it. */
  dispatch(method: string, path: string, body: unknown): Response {
    const match = this.match(method, path);
    if (!match) return { status: 404, body: { error: 'No such route' } };
    try {
      return { status: 200, body: this.handlers[match.route](match.request(body)) };
    } catch (error) {
      if (error instanceof ShopError) return { status: STATUS[error.code], body: { error: error.message } };
      return { status: 500, body: { error: 'Something went wrong' } };
    }
  }

  private match(
    method: string,
    path: string,
  ): { route: string; request: (body: unknown) => Request } | undefined {
    const parts = path.split('/').filter(Boolean);
    for (const route of Object.keys(this.handlers)) {
      const [routeMethod, routePath] = route.split(' ');
      const pattern = routePath.split('/').filter(Boolean);
      if (routeMethod !== method || pattern.length !== parts.length) continue;
      const params: Record<string, string> = {};
      const fits = pattern.every((piece, i) => {
        if (piece.startsWith(':')) {
          params[piece.slice(1)] = parts[i];
          return true;
        }
        return piece === parts[i];
      });
      if (fits) return { route, request: (body) => ({ params, body }) };
    }
    return undefined;
  }
}
