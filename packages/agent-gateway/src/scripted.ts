// A worker that replays stored plans and candidates. It makes the change loop
// deterministic: the flawed first candidate of the demo is stored, so detecting it
// never depends on an agent making the mistake (spec §9.1).
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentEvent, ChangeOp, Plan } from '@decker/deck-model';
import type { AgentWorker, Sandbox, WorkPackage } from './types.ts';

interface Scenario {
  dir: string;
  match: string;
  plan: Omit<Plan, 'approved' | 'limits'> & { limits?: string[] };
  candidates: string[];
}

function textOf(op: ChangeOp): string {
  switch (op.type) {
    case 'add_edge':
      return [op.label ?? '', ...op.bullets].join(' ');
    case 'add_block':
      return [op.name, ...op.bullets].join(' ');
    case 'rename':
      return op.name;
    case 'remove':
      return op.label;
    default:
      return op.text;
  }
}

export class ScriptedWorker implements AgentWorker {
  readonly name = 'scripted';
  private scenarios: Scenario[] = [];

  constructor(dir: string) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir).sort()) {
      const file = path.join(dir, entry, 'scenario.json');
      if (!existsSync(file)) continue;
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Omit<Scenario, 'dir'>;
      this.scenarios.push({ ...raw, dir: path.join(dir, entry) });
    }
  }

  get available(): boolean {
    return this.scenarios.length > 0;
  }

  private pick(pkg: WorkPackage): Scenario | undefined {
    const text = `${pkg.title} ${pkg.operations.map(textOf).join(' ')}`.toLowerCase();
    return this.scenarios.find((s) => text.includes(s.match.toLowerCase()));
  }

  async *plan(pkg: WorkPackage): AsyncIterable<AgentEvent> {
    const scenario = this.pick(pkg);
    if (!scenario) {
      yield {
        type: 'error',
        text: 'The scripted worker has no stored scenario for this change. Configure the Claude worker to plan arbitrary changes.',
      };
      return;
    }
    yield {
      type: 'text',
      text: `Reading the deck around ${pkg.operations.length} operation${pkg.operations.length === 1 ? '' : 's'}.`,
    };
    yield { type: 'plan', plan: { ...scenario.plan, limits: scenario.plan.limits ?? [], approved: false } };
    yield { type: 'done' };
  }

  async *implement(pkg: WorkPackage, sandbox: Sandbox): AsyncIterable<AgentEvent> {
    const scenario = this.pick(pkg);
    const name = scenario?.candidates[Math.min(pkg.candidate, scenario.candidates.length) - 1];
    if (!scenario || !name) {
      yield { type: 'error', text: 'No stored candidate for this change.' };
      return;
    }
    const source = path.join(scenario.dir, name);
    yield { type: 'text', text: `Applying stored candidate "${name}".` };
    const removals = path.join(source, 'delete.txt');
    if (existsSync(removals)) {
      for (const line of readFileSync(removals, 'utf8').split('\n')) {
        const rel = line.trim();
        if (!rel) continue;
        const target = path.resolve(pkg.worktree, rel);
        if (!target.startsWith(path.resolve(pkg.worktree) + path.sep)) continue;
        rmSync(target, { force: true });
        yield { type: 'tool', text: `delete ${rel}` };
      }
    }
    const files = path.join(source, 'files');
    if (existsSync(files)) {
      cpSync(files, pkg.worktree, { recursive: true, force: true });
      for (const rel of walk(files)) yield { type: 'tool', text: `write ${rel}` };
    }
    // Small candidates are stored as edits: find and replace, or append.
    const edits = path.join(source, 'edits.json');
    if (existsSync(edits)) {
      for (const edit of JSON.parse(readFileSync(edits, 'utf8')) as {
        file: string;
        find?: string;
        replace?: string;
        append?: string;
      }[]) {
        const target = path.resolve(pkg.worktree, edit.file);
        if (!target.startsWith(path.resolve(pkg.worktree) + path.sep) || !existsSync(target)) {
          yield {
            type: 'error',
            text: `The stored candidate edits ${edit.file}, which is not in the worktree.`,
          };
          return;
        }
        let text = readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
        if (edit.find !== undefined) {
          if (!text.includes(edit.find)) {
            yield { type: 'error', text: `The stored candidate no longer applies to ${edit.file}.` };
            return;
          }
          text = text.replace(edit.find, () => edit.replace ?? '');
        }
        if (edit.append) text += edit.append;
        writeFileSync(target, text);
        yield { type: 'tool', text: `edit ${edit.file}` };
      }
    }
    // An agent runs its commands through the sandbox and nowhere else.
    const command = existsSync(path.join(source, 'command.txt'))
      ? readFileSync(path.join(source, 'command.txt'), 'utf8').trim()
      : '';
    if (command) {
      const result = await sandbox.run(command);
      yield { type: 'tool', text: `$ ${command}  (exit ${result.exitCode})` };
    }
    const notes = path.join(source, 'notes.md');
    yield { type: 'done', text: existsSync(notes) ? readFileSync(notes, 'utf8').trim() : `Applied ${name}.` };
  }
}

function walk(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}
