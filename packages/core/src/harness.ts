// The harness runs the checks, not the agent (spec §6.1 step 5). An agent's statement
// that tests passed is not evidence; only these runs are.
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { CheckResult, DeckTest, Id, TestStatus } from '@decker/deck-model';
import type { CheckSpec } from './deckdir.ts';
import type { RunResult } from './sandbox.ts';

export interface HarnessRun {
  checks: CheckResult[];
  results: Record<Id, TestStatus>;
  failures: Record<Id, string>;
}

interface VitestReport {
  testResults?: {
    name: string;
    assertionResults?: {
      ancestorTitles?: string[];
      title: string;
      status: string;
      failureMessages?: string[];
    }[];
  }[];
}

const RESULTS = '.deck/cache/vitest-results.json';

/** Secrets for a check, by name, from a git-ignored env file. Only the harness reads it. */
export function readSecrets(root: string, check: CheckSpec): Record<string, string> | null {
  if (!check.secrets?.length) return {};
  const file = path.resolve(root, check.envFile ?? '.env');
  if (!existsSync(file)) return null;
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && check.secrets.includes(m[1]!)) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
  return check.secrets.every((name) => out[name]) ? out : null;
}

/**
 * Run each check with `exec`, which decides where it runs (a fresh container, or the host
 * when the engineer opted in) or returns a reason to skip it.
 */
export async function runChecks(
  cwd: string,
  checks: CheckSpec[],
  tests: readonly DeckTest[],
  exec: (check: CheckSpec, command: string) => Promise<RunResult | { skipped: string }>,
  progress?: (text: string) => void,
): Promise<HarnessRun> {
  const out: HarnessRun = { checks: [], results: {}, failures: {} };
  for (const check of checks) {
    const vitest = check.kind === 'vitest';
    const file = path.join(cwd, RESULTS);
    if (vitest) {
      mkdirSync(path.dirname(file), { recursive: true });
      rmSync(file, { force: true });
    }
    const command = vitest
      ? `${check.command} --reporter=default --reporter=json --outputFile.json=${RESULTS}`
      : check.command;
    progress?.(`check: ${check.name}`);
    const started = Date.now();
    const result = await exec(check, command);
    if ('skipped' in result) {
      out.checks.push({
        name: check.name,
        command: check.command,
        exitCode: 0,
        durationMs: 0,
        output: '',
        skipped: result.skipped,
      });
      continue;
    }
    out.checks.push({
      name: check.name,
      command: check.command,
      exitCode: result.exitCode,
      durationMs: Date.now() - started,
      output: result.output.slice(-20_000),
    });
    if (!vitest || !existsSync(file)) continue;
    try {
      const report = JSON.parse(readFileSync(file, 'utf8')) as VitestReport;
      const byKey = new Map<string, DeckTest>();
      for (const t of tests) byKey.set(`${t.source.path}#${[...t.suite, t.name].join('/')}`, t);
      for (const suite of report.testResults ?? []) {
        const name = suite.name.replace(/\\/g, '/');
        const rel = [...new Set(tests.map((t) => t.source.path))].find(
          (p) => name.endsWith(`/${p}`) || name === p,
        );
        if (!rel) continue;
        for (const a of suite.assertionResults ?? []) {
          const test = byKey.get(`${rel}#${[...(a.ancestorTitles ?? []), a.title].join('/')}`);
          if (!test) continue;
          const status: TestStatus =
            a.status === 'passed' ? 'passed' : a.status === 'failed' ? 'failed' : 'skipped';
          out.results[test.id] = status;
          // The first line says what failed. The rest is a stack trace full of machine paths.
          if (status === 'failed')
            out.failures[test.id] = (a.failureMessages?.[0] ?? '')
              .split('\n')[0]!
              .replace(/\s*\/\/.*$/, '')
              .slice(0, 200);
        }
      }
    } catch {
      // An unreadable report leaves the tests as not run, which is the truth.
    }
  }
  return out;
}
