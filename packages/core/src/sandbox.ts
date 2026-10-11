// The sandbox (spec §6.3). Repository code and agent-issued commands run in a container
// with the network off. Running on the host is an explicit opt-in for machines without a
// container runtime; it gives no isolation and the UI says so.
import { execFile, execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import type { Sandbox } from '@decker/agent-gateway';

export type SandboxKind = 'docker' | 'podman' | 'host' | 'none';

const OUTPUT_CAP = 200_000;
const TIMEOUT_MS = 10 * 60_000;

/** A container runtime whose daemon answers, if there is one. */
export function detectRuntime(): 'docker' | 'podman' | null {
  for (const cli of ['docker', 'podman'] as const) {
    try {
      execFileSync(cli, ['version', '--format', '{{.Server.Version}}'], {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 8000,
      });
      return cli;
    } catch {
      // not installed, or not running
    }
  }
  return null;
}

export interface RunResult {
  exitCode: number;
  output: string;
}

function collect(child: ReturnType<typeof spawn>, timeoutMs = TIMEOUT_MS): Promise<RunResult> {
  return new Promise((resolve) => {
    let output = '';
    const add = (chunk: Buffer) => {
      if (output.length < OUTPUT_CAP) output += chunk.toString('utf8');
    };
    child.stdout?.on('data', add);
    child.stderr?.on('data', add);
    const timer = setTimeout(() => {
      output += '\n[stopped: the time limit was reached]';
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 127, output: `${output}\n${err.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, output: output.slice(0, OUTPUT_CAP) });
    });
  });
}

const HOST_ENV = [
  'PATH',
  'Path',
  'SystemRoot',
  'SYSTEMROOT',
  'ComSpec',
  'PATHEXT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramFiles',
  'windir',
  'LANG',
];

/** No isolation: commands run on this machine, in the worktree, with a scrubbed environment. */
export class HostSandbox implements Sandbox {
  private cwd: string;
  private extraEnv: Record<string, string>;

  constructor(cwd: string, extraEnv: Record<string, string> = {}) {
    this.cwd = cwd;
    this.extraEnv = extraEnv;
  }

  run(command: string): Promise<RunResult> {
    const env: Record<string, string> = { CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' };
    for (const key of HOST_ENV) if (process.env[key]) env[key] = process.env[key]!;
    return collect(
      spawn(command, { cwd: this.cwd, shell: true, env: { ...env, ...this.extraEnv }, windowsHide: true }),
    );
  }
}

export interface ContainerSpec {
  cli: 'docker' | 'podman';
  image: string;
  /** The candidate's worktree: the only thing mounted. */
  mount: string;
  /** The deck root inside the worktree. */
  workdir: string;
}

function baseArgs(spec: ContainerSpec, network: boolean): string[] {
  const rel = path.relative(spec.mount, spec.workdir).split(path.sep).join('/');
  return [
    '--rm',
    ...(network ? [] : ['--network', 'none']),
    '--user',
    'node',
    '--read-only',
    '--tmpfs',
    '/tmp:exec',
    '--tmpfs',
    '/home/node',
    '--cpus',
    '2',
    '--memory',
    '3g',
    '--pids-limit',
    '512',
    '--env',
    'CI=1',
    '--env',
    'NO_COLOR=1',
    '--env',
    'HOME=/home/node',
    '--volume',
    `${spec.mount}:/work`,
    '--workdir',
    rel ? `/work/${rel}` : '/work',
  ];
}

/** One container per candidate, for the length of the agent run. Network off. */
export class ContainerSandbox implements Sandbox {
  private spec: ContainerSpec;
  private id: string | null = null;

  constructor(spec: ContainerSpec) {
    this.spec = spec;
  }

  /** Prepare: install dependencies from the lockfile, install scripts disabled, network on. */
  static prepare(spec: ContainerSpec): Promise<RunResult> {
    const install =
      'if [ -f package-lock.json ]; then npm ci --ignore-scripts --no-audit --no-fund; elif [ -f package.json ]; then npm install --ignore-scripts --no-audit --no-fund; fi';
    return collect(
      spawn(spec.cli, ['run', ...baseArgs(spec, true), spec.image, 'sh', '-lc', install], {
        windowsHide: true,
      }),
    );
  }

  /** A fresh container for one check, so nothing an agent left running can influence it. */
  static check(spec: ContainerSpec, command: string, env: Record<string, string> = {}): Promise<RunResult> {
    const envArgs = Object.entries(env).flatMap(([k, v]) => ['--env', `${k}=${v}`]);
    return collect(
      spawn(spec.cli, ['run', ...baseArgs(spec, false), ...envArgs, spec.image, 'sh', '-lc', command], {
        windowsHide: true,
      }),
    );
  }

  private start(): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        this.spec.cli,
        ['run', '--detach', ...baseArgs(this.spec, false), this.spec.image, 'sleep', 'infinity'],
        (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout.trim());
        },
      );
    });
  }

  async run(command: string): Promise<RunResult> {
    this.id ??= await this.start();
    return collect(spawn(this.spec.cli, ['exec', this.id, 'sh', '-lc', command], { windowsHide: true }));
  }

  async stop(): Promise<void> {
    if (!this.id) return;
    const id = this.id;
    this.id = null;
    await new Promise<void>((resolve) => execFile(this.spec.cli, ['rm', '--force', id], () => resolve()));
  }
}
