// decker <path-to-repo>     starts the local server and opens the browser
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { SandboxKind } from '@decker/core';
import { startServer } from './app.ts';

const HELP = `decker <path-to-repo> [options]

Compiles a TypeScript repository up to a map, and serves the map on 127.0.0.1.

  --port <n>          Port to listen on (default 4747, or the next free one)
  --no-open           Do not open the browser
  --sandbox <kind>    docker, podman, host, or none (default: whichever container runtime answers)
                      "host" runs checks and agent commands on this machine with no isolation
  --worker <name>     claude, scripted, or none (default: from .deck/deck.json, else claude)
  --token <t>         Use a fixed session token instead of a random one
  --no-watch          Do not watch the repository for changes
`;

export async function main(argv: string[]): Promise<void> {
  const args = [...argv];
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    if (i < 0) return undefined;
    const value = args[i + 1];
    args.splice(i, 2);
    return value;
  };
  const toggle = (name: string): boolean => {
    const i = args.indexOf(`--${name}`);
    if (i < 0) return false;
    args.splice(i, 1);
    return true;
  };
  if (toggle('help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }
  const noOpen = toggle('no-open');
  const noWatch = toggle('no-watch');
  const port = flag('port');
  const sandbox = flag('sandbox') as SandboxKind | undefined;
  const worker = flag('worker') as 'claude' | 'scripted' | 'none' | undefined;
  const token = flag('token');
  const target = args[0];
  if (!target) {
    process.stdout.write(HELP);
    process.exitCode = 1;
    return;
  }
  if (sandbox && !['docker', 'podman', 'host', 'none'].includes(sandbox)) throw new Error(`Unknown sandbox "${sandbox}".`);

  const started = Date.now();
  const server = await startServer({
    root: path.resolve(target),
    port: port ? Number(port) : undefined,
    token,
    sandbox: sandbox ?? 'auto',
    worker: worker ?? 'auto',
    watch: !noWatch,
    allowOrigins: process.env.DECKER_DEV_ORIGIN ? [process.env.DECKER_DEV_ORIGIN] : [],
  });
  const stats = server.service.snapshot().stats;
  const blocks = server.service.snapshot().nodes.filter((n) => n.kind === 'block').length;
  console.log(`decker: mapped ${path.basename(server.service.root)} in ${Date.now() - started} ms (${blocks} blocks, ${stats?.files ?? 0} files, extraction ${server.service.lastExtractMs} ms)`);
  if (server.service.sandbox === 'host') console.log('decker: sandbox is "host": checks and agent commands run on this machine with no isolation.');
  if (server.service.sandbox === 'none') console.log('decker: no container runtime answered. The map works; running checks and agents needs Docker or Podman, or --sandbox=host.');
  console.log(`decker: ${server.url}`);

  if (!noOpen) {
    const [cmd, cmdArgs] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', server.url]] : process.platform === 'darwin' ? ['open', [server.url]] : ['xdg-open', [server.url]];
    spawn(cmd as string, cmdArgs as string[], { stdio: 'ignore', detached: true, windowsVerbatimArguments: process.platform === 'win32' }).unref();
  }
  const stop = () => {
    void server.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
