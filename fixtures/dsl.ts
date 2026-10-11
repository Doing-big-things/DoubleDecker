// A small builder for hand-written deck fixtures. The content lives in shop.ts;
// this file only turns it into a DeckBundle with stable ids and plausible source text.
import {
  type Bullet,
  type DeckBundle,
  type DeckEdge,
  type DeckNode,
  type DeckTest,
  type EdgeKind,
  fnv1a,
  type Gap,
  type GapReason,
  hashId,
  humanize,
  type SourceRef,
  type TestStatus,
} from '@decker/deck-model';

export interface OpSpec {
  sig: string;
  /** Bullet text. Prefix "◦ " for an AI summary, "▪ " for authored, "~" to derive it from the name. */
  text: string;
  calls?: string[]; // "Block.operation"
  api?: Record<string, string>; // target -> label
  events?: Record<string, string>; // target -> event name
  via?: Record<string, string>; // target -> "via Interface"
  /** Test titles. Prefix "!" for failing, "-" for skipped. */
  tests?: string[];
  internal?: boolean;
  tags?: string[];
}

export interface BlockSpec {
  summary: string;
  path: string;
  ops: OpSpec[];
  notes?: string[];
  data?: string[];
  uses?: string[];
  usesTypes?: string[]; // "Block" names whose types this block uses
  gaps?: GapReason[];
  coverage?: DeckNode['coverage'];
  tags?: string[];
  /** false when the tests exist and were not run at this commit. */
  ran?: boolean;
  /** Tests that hang off the block by import or by name rather than by a direct call. */
  looseTests?: { title: string; via: 'imports' | 'name' }[];
}

export const op = (sig: string, text: string, rest: Omit<OpSpec, 'sig' | 'text'> = {}): OpSpec => ({
  sig,
  text,
  ...rest,
});

function parseBullet(raw: string, key: string, sigName: string, ref: SourceRef): Bullet {
  if (raw.startsWith('◦ '))
    return { id: hashId('bullet', key), text: raw.slice(2), origin: 'summarized', derivedFrom: ref };
  if (raw.startsWith('▪ ')) return { id: hashId('bullet', key), text: raw.slice(2), origin: 'authored' };
  if (raw === '~')
    return {
      id: hashId('bullet', key),
      text: humanize(sigName),
      origin: 'declared',
      basis: 'name',
      derivedFrom: ref,
    };
  return { id: hashId('bullet', key), text: raw, origin: 'declared', basis: 'doc', derivedFrom: ref };
}

export class DeckBuilder {
  private nodes: DeckNode[] = [];
  private edges: DeckEdge[] = [];
  private tests: DeckTest[] = [];
  private gaps: Gap[] = [];
  private results: Record<string, TestStatus> = {};
  private sources: Record<string, string> = {};
  private areaStack: string[] = [];
  private pending: (() => void)[] = [];
  private opIds = new Map<string, string>();
  private blockIds = new Map<string, string>();
  private externals = new Map<string, string>();
  readonly systemId: string;
  readonly name: string;

  constructor(name: string) {
    this.name = name;
    this.systemId = hashId('system', name);
    this.nodes.push({
      id: this.systemId,
      kind: 'system',
      name,
      parentId: null,
      bullets: [],
      source: [],
      coverage: 'full',
    });
  }

  area(name: string, body: () => void, summary?: string): void {
    const parentId = this.areaStack.at(-1) ?? this.systemId;
    const id = hashId('area', `${parentId}/${name}`);
    this.nodes.push({
      id,
      kind: 'area',
      name,
      parentId,
      summary: summary
        ? { id: hashId('bullet', `${id}:summary`), text: summary, origin: 'declared', basis: 'doc' }
        : undefined,
      bullets: [],
      source: [],
      coverage: 'full',
    });
    this.areaStack.push(id);
    body();
    this.areaStack.pop();
  }

  private external(pkg: string): string {
    let id = this.externals.get(pkg);
    if (!id) {
      id = hashId('external', pkg);
      this.externals.set(pkg, id);
      this.nodes.push({
        id,
        kind: 'external',
        name: pkg,
        parentId: this.systemId,
        bullets: [],
        source: [],
        coverage: 'full',
      });
    }
    return id;
  }

  block(name: string, spec: BlockSpec): void {
    const parentId = this.areaStack.at(-1) ?? this.systemId;
    const id = hashId('block', spec.path);
    this.blockIds.set(name, id);

    // Write a plausible source file so the code peek has something real to show.
    const lines: string[] = [`/** ${spec.summary}. */`, ''];
    for (const u of spec.uses ?? [])
      lines.push(`import * as ${u.replace(/[^a-z]/gi, '') || 'dep'} from '${u}';`);
    if (spec.uses?.length) lines.push('');
    const dataNodes: DeckNode[] = [];
    for (const d of spec.data ?? []) {
      const start = lines.length + 1;
      const dataName = d.replace(/^(interface|type|enum|class)\s+/, '').split(/[\s<{=]/)[0]!;
      lines.push(
        `export ${d.includes('{') || d.includes('=') ? d : d.startsWith('type') ? `${d} = string;` : `${d} {}`}`,
        '',
      );
      const ref: SourceRef = {
        path: spec.path,
        symbol: dataName,
        startLine: start,
        endLine: start,
        hash: fnv1a(d),
      };
      dataNodes.push({
        id: hashId('data', `${spec.path}#${dataName}`),
        kind: 'data',
        name: dataName,
        parentId: id,
        bullets: [],
        signature: d.split(/\s*[{=]/)[0]!.trim(),
        source: [ref],
        coverage: 'full',
      });
    }

    const opNodes: DeckNode[] = [];
    const testLines: string[] = [
      `import { describe, expect, it } from 'vitest';`,
      `import * as subject from './${spec.path.split('/').at(-1)!.replace(/\.ts$/, '')}';`,
      '',
    ];
    const testPath = spec.path.replace(/\.ts$/, '.test.ts');
    let hasTests = false;

    for (const o of spec.ops) {
      const opName = o.sig.split(/[(<]/)[0]!.trim();
      const opId = hashId('operation', `${spec.path}#${opName}`);
      this.opIds.set(`${name}.${opName}`, opId);
      const isDoc = !o.text.startsWith('~') && !o.text.startsWith('◦ ') && !o.text.startsWith('▪ ');
      if (isDoc) lines.push(`/** ${o.text}. */`);
      const start = lines.length + 1;
      const body = (o.calls ?? []).map((c) => `  ${c.replace(/^(\w)/, (m) => m.toLowerCase())}();`);
      lines.push(
        `${o.internal ? '' : 'export '}function ${o.sig} {`,
        ...(body.length ? body : ['  // …']),
        '}',
        '',
      );
      const end = lines.length - 1;
      const ref: SourceRef = {
        path: spec.path,
        symbol: opName,
        startLine: start,
        endLine: end,
        hash: fnv1a(o.sig),
      };
      const bullets: Bullet[] = [parseBullet(o.text, `${opId}:b`, opName, ref)];
      if (o.text !== '~')
        bullets.push({
          id: hashId('bullet', `${opId}:name`),
          text: humanize(opName),
          origin: 'declared',
          basis: 'name',
          derivedFrom: ref,
        });
      const tags = [...(o.tags ?? []), ...(o.internal ? ['internal'] : [])];
      opNodes.push({
        id: opId,
        kind: 'operation',
        name: opName,
        parentId: id,
        bullets,
        signature: o.sig,
        source: [ref],
        coverage: 'full',
        tags: tags.length ? tags : undefined,
      });

      if (o.tests?.length) {
        hasTests = true;
        testLines.push(`describe('${opName}', () => {`);
        for (const raw of o.tests) {
          const failing = raw.startsWith('!');
          const skipped = raw.startsWith('-');
          const title = failing || skipped ? raw.slice(1) : raw;
          const line = testLines.length + 1;
          testLines.push(`  it('${title}', () => {`, `    expect(subject.${opName}).toBeDefined();`, '  });');
          const testId = hashId('test', `${testPath}#${opName}/${title}`);
          this.tests.push({
            id: testId,
            name: title,
            suite: [opName],
            source: { path: testPath, startLine: line, endLine: line + 2, hash: fnv1a(title) },
            targets: [{ id: opId, via: 'calls' }],
          });
          if (spec.ran !== false) this.results[testId] = failing ? 'failed' : skipped ? 'skipped' : 'passed';
        }
        testLines.push('});', '');
      }

      const edge = (target: string, kind: EdgeKind, label?: string, indirect?: string) => {
        this.pending.push(() => {
          const to = this.opIds.get(target) ?? this.blockIds.get(target);
          if (!to) throw new Error(`fixture: unknown target "${target}" from ${name}.${opName}`);
          this.edges.push({
            id: hashId('edge', `${opId}->${to}:${kind}`),
            from: opId,
            to,
            kind,
            label,
            indirect,
            bullets: [],
            evidence: [
              {
                path: spec.path,
                symbol: opName,
                startLine: start + 1,
                endLine: start + 1,
                hash: fnv1a(target),
              },
            ],
          });
        });
      };
      for (const c of o.calls ?? []) edge(c, 'call', undefined, o.via?.[c]);
      for (const [target, label] of Object.entries(o.api ?? {})) edge(target, 'api', label);
      for (const [target, label] of Object.entries(o.events ?? {})) edge(target, 'event', label);
    }

    for (const loose of spec.looseTests ?? []) {
      hasTests = true;
      const line = testLines.length + 1;
      testLines.push(`it('${loose.title}', () => {`, '  expect(subject).toBeDefined();', '});');
      const testId = hashId('test', `${testPath}#${loose.title}`);
      this.tests.push({
        id: testId,
        name: loose.title,
        suite: [],
        source: { path: testPath, startLine: line, endLine: line + 2, hash: fnv1a(loose.title) },
        targets: [{ id, via: loose.via }],
      });
      if (spec.ran !== false) this.results[testId] = 'passed';
    }

    this.sources[spec.path] = lines.join('\n');
    if (hasTests) this.sources[testPath] = testLines.join('\n');

    const blockRef: SourceRef = {
      path: spec.path,
      startLine: 1,
      endLine: lines.length,
      hash: fnv1a(lines.join('\n')),
    };
    const notes = (spec.notes ?? []).map((n, i) => parseBullet(n, `${id}:note${i}`, name, blockRef));
    (spec.gaps ?? []).forEach((reason, i) => {
      const line = Math.min(lines.length, 4 + i * 3);
      this.gaps.push({
        ownerId: id,
        reason,
        source: { path: spec.path, startLine: line, endLine: line, hash: fnv1a(`${reason}${i}`) },
      });
    });
    this.nodes.push({
      id,
      kind: 'block',
      name,
      parentId,
      summary: {
        id: hashId('bullet', `${id}:summary`),
        text: spec.summary,
        origin: 'declared',
        basis: 'doc',
        derivedFrom: { ...blockRef, endLine: 1 },
      },
      bullets: notes,
      source: [blockRef],
      coverage: spec.coverage ?? (spec.gaps?.length ? 'partial' : 'full'),
      tags: spec.tags,
    });
    this.nodes.push(...opNodes, ...dataNodes);

    for (const pkg of spec.uses ?? []) {
      const ext = this.external(pkg);
      this.edges.push({
        id: hashId('edge', `${id}->${ext}:dependency`),
        from: id,
        to: ext,
        kind: 'dependency',
        bullets: [],
        evidence: [{ path: spec.path, startLine: 3, endLine: 3, hash: fnv1a(pkg) }],
      });
    }
    for (const target of spec.usesTypes ?? []) {
      this.pending.push(() => {
        const to = this.blockIds.get(target);
        if (!to) throw new Error(`fixture: unknown type owner "${target}" from ${name}`);
        this.edges.push({
          id: hashId('edge', `${id}->${to}:data`),
          from: id,
          to,
          kind: 'data',
          bullets: [],
          evidence: [],
        });
      });
    }
  }

  build(): DeckBundle {
    for (const run of this.pending) run();
    this.pending = [];
    const callEdges = this.edges.filter((e) => e.kind !== 'dependency' && e.kind !== 'data').length;
    return {
      name: this.name,
      snapshot: {
        schemaVersion: 1,
        sourceCommit: 'fixture0000000000000000000000000000000000',
        dirty: false,
        adapter: { name: 'fixture', version: '1', configHash: 'fixture' },
        nodes: this.nodes,
        edges: this.edges,
        tests: this.tests,
        gaps: this.gaps,
        stats: {
          files: Object.keys(this.sources).length,
          lines: Object.values(this.sources).reduce((n, s) => n + s.split('\n').length, 0),
          callSites: callEdges + this.gaps.length,
          resolvedCallSites: callEdges,
          imports: this.edges.length - callEdges,
          resolvedImports: this.edges.length - callEdges,
        },
      },
      layout: null,
      notes: { version: 1, bullets: {}, dismissed: [] },
      testRun: {
        commit: 'fixture0000000000000000000000000000000000',
        treeHash: 'fixture',
        ranAt: '2026-10-11T00:00:00.000Z',
        results: this.results,
        checks: [],
      },
      changes: [],
      capabilities: { server: false, editor: false, sandbox: 'none', worker: 'none', summarizer: false },
      changedSinceBaseline: [],
      treeHash: 'fixture',
      sources: this.sources,
    };
  }
}
