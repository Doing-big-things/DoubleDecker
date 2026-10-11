import { createServer } from 'node:http';
import { createShop } from './app';

/** Start the HTTP listener. The entry point of the service. */
export function startServer(port: number): { close(): void } {
  const shop = createShop();
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const result = shop.router.dispatch(
        req.method ?? 'GET',
        req.url ?? '/',
        text ? JSON.parse(text) : undefined,
      );
      res.writeHead(result.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result.body));
    });
  });
  server.listen(port);
  return { close: () => server.close() };
}
