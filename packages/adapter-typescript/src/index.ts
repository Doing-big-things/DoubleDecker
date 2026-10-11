// Compile up (spec §5): extract a deck snapshot from a TypeScript project.
// All compiler access lives in this package. It uses the TypeScript 6 API bundled with
// ts-morph, which is independent of whatever compiler the target repository uses.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  type Bullet,
  type DeckEdge,
  type DeckNode,
  type DeckSnapshot,
  type DeckTest,
  type EdgeKind,
  firstSentence,
  type Gap,
  type GapReason,
  hashId,
  humanize,
  type Id,
  type SourceRef,
  snapshotSchema,
} from '@decker/deck-model';
import { Project, ts } from 'ts-morph';
import { assignIds, type Entity, type IdsFile, type RenameSuggestion } from './identity.ts';

export { confirmRename, emptyIds, type IdsFile, type RenameSuggestion } from './identity.ts';

export const ADAPTER_VERSION = '0.1.0';

export interface AdapterSettings {
  /** tsconfig to load, relative to the root. Defaults to tsconfig.json. */
  tsconfig?: string;
  /** Regular expressions (as strings) that mark a path as a test file. */
  testPatterns?: string[];
  /** Regular expressions for paths to leave out altogether. */
  exclude?: string[];
  /** The system's name. Defaults to the name of the root directory. */
  name?: string;
}

export interface ExtractInput {
  commit: string;
  dirty: boolean;
  ids: IdsFile;
  /** Files git reports as renamed: old path -> new path. */
  renames?: Record<string, string>;
}

export interface ExtractResult {
  snapshot: DeckSnapshot;
  ids: IdsFile;
  suggestions: RenameSuggestion[];
  ms: number;
}

const DEFAULT_TESTS = ['\\.(test|spec)\\.[cm]?[jt]sx?$', '(^|/)__tests__/', '(^|/)__mocks__/'];
const DEFAULT_EXCLUDE = [
  '(^|/)node_modules/',
  '(^|/)dist/',
  '(^|/)build/',
  '(^|/)coverage/',
  '(^|/)\\.deck/',
  '\\.d\\.[cm]?ts$',
];
const SOURCE = /\.[cm]?[jt]sx?$/;
const HTTP_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all']);
const ROUTE_LITERAL = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ALL)\s+(\/\S*)$/;
const BUILTINS = new Set(
  'assert buffer child_process cluster crypto dns events fs http http2 https net os path perf_hooks process querystring readline stream string_decoder timers tls tty url util v8 vm worker_threads zlib'.split(
    ' ',
  ),
);

const sha = (text: string, n = 12): string => createHash('sha1').update(text).digest('hex').slice(0, n);
const posix = (p: string): string => p.replace(/\\/g, '/');
const noExt = (p: string): string => p.replace(/\.[cm]?[jt]sx?$/, '');

function pascal(name: string): string {
  return name
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

/** The identifier at the root of an expression such as it.each(...)(...) or describe.skip. */
function baseIdentifier(expr: ts.Expression): string | undefined {
  let e: ts.Node = expr;
  for (;;) {
    if (ts.isIdentifier(e)) return e.text;
    if (
      ts.isPropertyAccessExpression(e) ||
      ts.isCallExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isParenthesizedExpression(e)
    )
      e = e.expression;
    else if (ts.isTaggedTemplateExpression(e)) e = e.tag;
    else return undefined;
  }
}

const literalText = (node: ts.Node | undefined): string | undefined =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;

/**
 * The function an initializer holds, looking through parentheses and casts:
 * `const Suspense: FC = ((props) => { ... }) as any` is still a function.
 */
function functionOf(node: ts.Node | undefined): ts.ArrowFunction | ts.FunctionExpression | undefined {
  let cur = node;
  while (
    cur &&
    (ts.isParenthesizedExpression(cur) ||
      ts.isAsExpression(cur) ||
      ts.isSatisfiesExpression(cur) ||
      ts.isTypeAssertionExpression(cur) ||
      ts.isNonNullExpression(cur))
  )
    cur = cur.expression;
  return cur && (ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) ? cur : undefined;
}

const isFunctionLike = (node: ts.Node | undefined): node is ts.ArrowFunction | ts.FunctionExpression =>
  node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));

function docOf(node: ts.Node): string | undefined {
  const docs = (node as { jsDoc?: ts.JSDoc[] }).jsDoc;
  const last = docs?.at(-1);
  if (!last) return undefined;
  const text = ts.getTextOfJSDocComment(last.comment);
  return text?.trim() ? firstSentence(text) : undefined;
}

interface FileInfo {
  sf: ts.SourceFile;
  rel: string; // path relative to the root, posix
  isTest: boolean;
}

interface OpDraft {
  entity: Entity;
  name: string;
  signature: string;
  decl: ts.Node;
  body?: ts.Node;
  doc?: string;
  borrow?: string;
  tags: string[];
}

interface BlockDraft {
  entity: Entity;
  name: string;
  dir: string; // directory relative to the root
  files: FileInfo[];
  ops: OpDraft[];
  data: { entity: Entity; name: string; signature: string; decl: ts.Node; sf: FileInfo }[];
  summary?: { text: string; node: ts.Node; sf: FileInfo };
  topLevel: { node: ts.Node; sf: FileInfo }[];
}

export class TypeScriptAdapter {
  readonly root: string;
  readonly settings: AdapterSettings;
  private project: Project;
  private testRe: RegExp[];
  private excludeRe: RegExp[];

  constructor(root: string, settings: AdapterSettings = {}) {
    this.root = path.resolve(root);
    this.settings = settings;
    this.testRe = (settings.testPatterns ?? DEFAULT_TESTS).map((p) => new RegExp(p));
    this.excludeRe = [...DEFAULT_EXCLUDE, ...(settings.exclude ?? [])].map((p) => new RegExp(p));
    this.project = this.load();
  }

  get configHash(): string {
    return sha(JSON.stringify({ v: ADAPTER_VERSION, s: { ...this.settings, name: undefined } }), 10);
  }

  private load(): Project {
    const configPath = path.join(this.root, this.settings.tsconfig ?? 'tsconfig.json');
    const lenient: ts.CompilerOptions = { allowJs: true, noEmit: true, skipLibCheck: true };
    if (existsSync(configPath)) {
      const project = new Project({ tsConfigFilePath: configPath, compilerOptions: lenient });
      // Follow project references: a root config may list no files of its own.
      const raw = ts.readConfigFile(configPath, ts.sys.readFile).config as
        | { references?: { path: string }[] }
        | undefined;
      for (const ref of raw?.references ?? []) {
        let target = path.resolve(path.dirname(configPath), ref.path);
        if (!target.endsWith('.json')) target = path.join(target, 'tsconfig.json');
        if (existsSync(target)) project.addSourceFilesFromTsConfig(target);
      }
      if (this.files(project).length > 0) return project;
    }
    const project = new Project({
      compilerOptions: {
        ...lenient,
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        jsx: ts.JsxEmit.Preserve,
      },
    });
    const base = existsSync(path.join(this.root, 'src')) ? 'src' : '.';
    project.addSourceFilesAtPaths([
      `${posix(this.root)}/${base}/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}`,
      '!**/node_modules/**',
      '!**/dist/**',
    ]);
    return project;
  }

  /** Re-read changed files from disk. With no arguments, reload the whole project. */
  refresh(changed?: string[]): void {
    if (!changed) {
      this.project = this.load();
      return;
    }
    for (const file of changed) {
      const abs = path.resolve(this.root, file);
      if (!SOURCE.test(abs)) continue;
      const sf = this.project.getSourceFile(abs);
      if (existsSync(abs)) {
        if (sf) sf.refreshFromFileSystemSync();
        else this.project.addSourceFileAtPathIfExists(abs);
      } else if (sf) this.project.removeSourceFile(sf);
    }
  }

  private files(project: Project): FileInfo[] {
    const program = project.getProgram().compilerObject;
    const out: FileInfo[] = [];
    for (const sf of program.getSourceFiles()) {
      const abs = path.resolve(sf.fileName);
      const rel = posix(path.relative(this.root, abs));
      if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
      if (!SOURCE.test(rel) || this.excludeRe.some((r) => r.test(rel))) continue;
      out.push({ sf, rel, isTest: this.testRe.some((r) => r.test(rel)) });
    }
    return out.sort((a, b) => a.rel.localeCompare(b.rel));
  }

  extract(input: ExtractInput): ExtractResult {
    const started = performance.now();
    const program = this.project.getProgram().compilerObject;
    const checker = program.getTypeChecker();
    const files = this.files(this.project);
    const sources = files.filter((f) => !f.isTest);
    const tests = files.filter((f) => f.isTest);
    const systemName = this.settings.name ?? path.basename(this.root);

    const ref = (f: FileInfo, node: ts.Node, symbol?: string): SourceRef => {
      const start = node.getStart(f.sf);
      return {
        path: f.rel,
        symbol,
        startLine: f.sf.getLineAndCharacterOfPosition(start).line + 1,
        endLine: f.sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
        hash: sha(f.sf.text.slice(start, node.getEnd())),
      };
    };

    // ---- 1. Blocks: one per source file with a public surface, or per barrel directory.
    const commonRoot = (() => {
      const dirs = sources.map((f) => path.posix.dirname(f.rel).split('/'));
      if (dirs.length === 0) return '';
      let prefix = dirs[0]!;
      for (const d of dirs) {
        let i = 0;
        while (i < prefix.length && i < d.length && prefix[i] === d[i]) i += 1;
        prefix = prefix.slice(0, i);
      }
      return prefix.filter((p) => p !== '.').join('/');
    })();

    // When one folder holds most of the code (src/ beside scripts and benchmarks), its
    // contents become the top level of the map instead of sitting inside one giant area.
    const primaryRoot = (() => {
      const counts = new Map<string, number>();
      for (const f of sources) {
        const rest = commonRoot ? f.rel.slice(commonRoot.length + 1) : f.rel;
        const seg = rest.includes('/') ? rest.split('/')[0]! : '';
        counts.set(seg, (counts.get(seg) ?? 0) + 1);
      }
      for (const [seg, count] of counts)
        if (seg && counts.size > 1 && count / sources.length >= 0.7)
          return commonRoot ? `${commonRoot}/${seg}` : seg;
      return commonRoot;
    })();

    // A file that declares nothing of its own: imports, re-exports, and augmentations of
    // other modules. It is a way in to other blocks, not a block.
    const isBarrel = (sf: ts.SourceFile): boolean =>
      sf.statements.some((s) => ts.isExportDeclaration(s)) &&
      sf.statements.every(
        (s) =>
          ts.isExportDeclaration(s) ||
          ts.isImportDeclaration(s) ||
          (ts.isModuleDeclaration(s) && ts.isStringLiteral(s.name)),
      );
    const exported = (node: ts.Node): boolean =>
      (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
    // What a file exports by name after declaring it: `export { Hono as HonoBase }`.
    const exportLists = new Map<ts.SourceFile, Map<string, string>>();
    const exportList = (sf: ts.SourceFile): Map<string, string> => {
      let list = exportLists.get(sf);
      if (!list) {
        list = new Map();
        for (const s of sf.statements) {
          if (
            ts.isExportDeclaration(s) &&
            !s.moduleSpecifier &&
            s.exportClause &&
            ts.isNamedExports(s.exportClause)
          )
            for (const e of s.exportClause.elements) list.set((e.propertyName ?? e.name).text, e.name.text);
          else if (ts.isExportAssignment(s) && ts.isIdentifier(s.expression))
            list.set(s.expression.text, 'default');
        }
        exportLists.set(sf, list);
      }
      return list;
    };

    const byDir = new Map<string, FileInfo[]>();
    for (const f of sources) {
      const dir = path.posix.dirname(f.rel);
      byDir.set(dir, [...(byDir.get(dir) ?? []), f]);
    }
    const hasSubdirs = (dir: string) => [...byDir.keys()].some((d) => d.startsWith(`${dir}/`));

    const blocks: BlockDraft[] = [];
    const blockOfFile = new Map<string, BlockDraft>();
    const newBlock = (file: FileInfo, name: string, dir: string, members: FileInfo[]): BlockDraft => {
      const block: BlockDraft = {
        entity: { kind: 'block', path: noExt(file.rel), name: '' },
        name,
        dir,
        files: members,
        ops: [],
        data: [],
        topLevel: [],
      };
      blocks.push(block);
      for (const m of members) blockOfFile.set(m.rel, block);
      return block;
    };

    for (const [dir, members] of byDir) {
      const index = members.find((f) => /^index\.[cm]?[jt]sx?$/.test(path.posix.basename(f.rel)));
      const dirName =
        dir === '.' || dir === commonRoot || dir === primaryRoot ? systemName : path.posix.basename(dir);
      if (index && isBarrel(index.sf) && !hasSubdirs(dir) && members.length > 1) {
        // A directory whose index re-exports its contents is one block; its files are internals.
        newBlock(index, pascal(dirName), path.posix.dirname(dir), members);
        continue;
      }
      for (const f of members) {
        if (isBarrel(f.sf)) continue;
        if (f.sf.statements.every((s) => ts.isImportDeclaration(s))) continue;
        const base = noExt(path.posix.basename(f.rel));
        newBlock(f, base === 'index' ? pascal(dirName) : pascal(base), dir, [f]);
      }
    }

    // A directory holding a single block is that block, placed in the parent directory.
    const countIn = (dir: string) =>
      blocks.filter((b) => b.dir === dir || b.dir.startsWith(`${dir}/`)).length;
    for (const block of blocks) {
      while (
        block.dir !== '.' &&
        block.dir !== commonRoot &&
        block.dir !== primaryRoot &&
        block.dir.length > commonRoot.length &&
        countIn(block.dir) === 1
      ) {
        if (/^index$/.test(noExt(path.posix.basename(block.files[0]!.rel))))
          block.name = pascal(path.posix.basename(block.dir));
        block.dir = path.posix.dirname(block.dir);
      }
    }

    // Two blocks in one area never share a name. One that was lifted out of its own folder
    // takes that folder's name, and an index beside a file of the same name says it is the index.
    const named = new Map<string, BlockDraft[]>();
    for (const block of blocks) {
      const key = `${block.dir}|${block.name}`;
      named.set(key, [...(named.get(key) ?? []), block]);
    }
    for (const group of named.values()) {
      if (group.length < 2) continue;
      for (const block of group) {
        const file = block.files[0]!.rel;
        const home = path.posix.dirname(file);
        if (home !== block.dir) block.name = pascal(path.posix.basename(home));
        else if (/^index$/.test(noExt(path.posix.basename(file)))) block.name = `${block.name}Index`;
      }
    }

    // ---- 2. Operations and data inside each block.
    const opOfDecl = new Map<ts.Node, { op: OpDraft; block: BlockDraft }>();
    const blockOfClass = new Map<ts.Node, BlockDraft>();
    const implementers = new Map<ts.Node, ts.ClassDeclaration[]>();

    const signatureOf = (name: string, fn: ts.SignatureDeclaration): string => {
      const params = fn.parameters.map((p) => {
        const type = p.type ? p.type.getText() : short(checker.typeToString(checker.getTypeAtLocation(p)));
        return `${p.dotDotDotToken ? '...' : ''}${p.name.getText()}${p.questionToken || p.initializer ? '?' : ''}: ${type}`;
      });
      const sig = checker.getSignatureFromDeclaration(fn);
      const ret = fn.type
        ? fn.type.getText()
        : sig
          ? short(checker.typeToString(checker.getReturnTypeOfSignature(sig)))
          : 'void';
      const generics = fn.typeParameters?.length
        ? `<${fn.typeParameters.map((t) => t.name.text).join(', ')}>`
        : '';
      return `${name}${generics}(${params.join(', ')}): ${ret}`.replace(/\s+/g, ' ');
    };
    const short = (text: string) => (text.length > 70 ? `${text.slice(0, 67)}…` : text);
    const shapeOf = (fn: ts.SignatureDeclaration & { body?: ts.Node }): string =>
      sha(
        `${fn.parameters.map((p) => p.getText()).join(',')}|${fn.type?.getText() ?? ''}|${fn.body?.getText() ?? ''}`.replace(
          /\s+/g,
          ' ',
        ),
      );

    for (const block of blocks) {
      const primary = block.name.toLowerCase();
      const addOp = (
        f: FileInfo,
        name: string,
        key: string,
        decl: ts.Node,
        fn: ts.SignatureDeclaration & { body?: ts.Node },
        tags: string[],
        docNode: ts.Node,
      ) => {
        const op: OpDraft = {
          entity: { kind: 'operation', path: noExt(f.rel), name: key, shape: shapeOf(fn) },
          name,
          signature: signatureOf(name, fn),
          decl,
          body: fn.body,
          doc: docOf(docNode),
          tags,
        };
        block.ops.push(op);
        opOfDecl.set(decl, { op, block });
        if (decl !== fn) opOfDecl.set(fn, { op, block });
      };

      for (const f of block.files) {
        // In a barrel block, only what the index re-exports is public.
        const reexported = block.files.length > 1 ? this.reexports(block.files, checker) : null;
        const listed = exportList(f.sf);
        const isPublic = (node: ts.Node, name: string) =>
          (exported(node) || listed.has(name)) &&
          (!reexported ||
            reexported.has(listed.get(name) ?? name) ||
            /^index$/.test(noExt(path.posix.basename(f.rel))));

        for (const st of f.sf.statements) {
          if (ts.isFunctionDeclaration(st) && st.name && st.body) {
            addOp(f, st.name.text, st.name.text, st, st, isPublic(st, st.name.text) ? [] : ['internal'], st);
          } else if (ts.isVariableStatement(st)) {
            for (const d of st.declarationList.declarations) {
              const fn = functionOf(d.initializer);
              if (!ts.isIdentifier(d.name) || !fn) continue;
              addOp(f, d.name.text, d.name.text, d, fn, isPublic(st, d.name.text) ? [] : ['internal'], st);
            }
            if (!st.declarationList.declarations.some((d) => functionOf(d.initializer)))
              block.topLevel.push({ node: st, sf: f });
          } else if (ts.isClassDeclaration(st) && st.name) {
            blockOfClass.set(st, block);
            const className = st.name.text;
            // A class exported under another name is known to the rest of the code by that name.
            const own =
              (listed.get(className) ?? className).toLowerCase() === primary ||
              className.toLowerCase() === primary;
            const pub = isPublic(st, className);
            for (const clause of st.heritageClauses ?? []) {
              if (clause.token !== ts.SyntaxKind.ImplementsKeyword) continue;
              for (const t of clause.types) {
                const decl =
                  checker.getTypeAtLocation(t.expression).getSymbol()?.declarations?.[0] ??
                  checker.getSymbolAtLocation(t.expression)?.declarations?.[0];
                const target =
                  decl && ts.isImportSpecifier(decl)
                    ? checker.getAliasedSymbol(checker.getSymbolAtLocation(t.expression)!).declarations?.[0]
                    : decl;
                if (target) implementers.set(target, [...(implementers.get(target) ?? []), st]);
              }
            }
            for (const m of st.members) {
              // Methods, and properties that hold a function (handler = () => ...), are operations.
              const fn =
                ts.isMethodDeclaration(m) && m.body
                  ? m
                  : ts.isPropertyDeclaration(m)
                    ? functionOf(m.initializer)
                    : undefined;
              if (!fn || !m.name || !ts.isIdentifier(m.name)) continue;
              const flags = ts.getCombinedModifierFlags(m as ts.Declaration);
              const hidden =
                (flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) !== 0 ||
                m.name.text.startsWith('_');
              const name = own ? m.name.text : `${className}.${m.name.text}`;
              addOp(f, name, `${className}.${m.name.text}`, m, fn, pub && !hidden ? [] : ['internal'], m);
            }
            if (!block.summary && own) {
              const doc = docOf(st);
              if (doc) block.summary = { text: doc, node: st, sf: f };
            }
          } else if (
            ts.isInterfaceDeclaration(st) ||
            ts.isTypeAliasDeclaration(st) ||
            ts.isEnumDeclaration(st)
          ) {
            if (!exported(st) && !listed.has(st.name.text)) continue;
            const kind = ts.isInterfaceDeclaration(st)
              ? 'interface'
              : ts.isEnumDeclaration(st)
                ? 'enum'
                : 'type';
            block.data.push({
              entity: { kind: 'data', path: noExt(f.rel), name: st.name.text },
              name: st.name.text,
              signature: `${kind} ${st.name.text}`,
              decl: st,
              sf: f,
            });
          } else if (ts.isExpressionStatement(st)) {
            block.topLevel.push({ node: st, sf: f });
          }
        }

        // Summary: a file-level doc comment, else the doc of the one thing the file is about.
        if (!block.summary) {
          const first = f.sf.statements[0];
          const fileDoc = first && ts.isImportDeclaration(first) ? docOf(first) : undefined;
          if (first && fileDoc) block.summary = { text: fileDoc, node: first, sf: f };
        }
      }
      if (!block.summary) {
        const f = block.files[0]!;
        const listed = exportList(f.sf);
        const publicName = (s: ts.Statement) => {
          const own = (s as ts.DeclarationStatement).name?.text ?? '';
          return listed.get(own) ?? own;
        };
        const publics = f.sf.statements.filter(
          (s) =>
            (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s)) &&
            (exported(s) || listed.has(s.name?.text ?? '')),
        );
        const named =
          publics.find((s) => publicName(s).toLowerCase() === primary) ??
          (publics.length === 1 ? publics[0] : undefined);
        const doc = named ? docOf(named) : undefined;
        if (named && doc) block.summary = { text: doc, node: named, sf: f };
      }
    }

    // ---- 3. Routes: a literal route registration is an operation tagged api.
    const routeHandlers = new Map<ts.Node, OpDraft>();
    const fileOf = (node: ts.Node) => files.find((f) => f.sf === node.getSourceFile())!;
    const routeOf = (call: ts.CallExpression): { route: string; handler: ts.Node } | undefined => {
      if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
      const method = call.expression.name.text;
      const first = literalText(call.arguments[0]);
      const handler = call.arguments.at(-1);
      if (!first || !handler || call.arguments.length < 2) return undefined;
      const literal = first.match(ROUTE_LITERAL);
      const route = literal
        ? `${literal[1]} ${literal[2]}`
        : HTTP_VERBS.has(method) && first.startsWith('/')
          ? `${method.toUpperCase()} ${first}`
          : undefined;
      return route ? { route, handler } : undefined;
    };
    for (const block of blocks) {
      const scan = (node: ts.Node, f: FileInfo) => {
        if (ts.isCallExpression(node)) {
          const hit = routeOf(node);
          if (hit && isFunctionLike(hit.handler)) {
            const op: OpDraft = {
              entity: {
                kind: 'operation',
                path: noExt(f.rel),
                name: `route:${hit.route}`,
                shape: sha(hit.handler.getText().replace(/\s+/g, ' ')),
              },
              name: hit.route,
              signature: hit.route,
              decl: node,
              body: hit.handler.body,
              tags: ['api'],
            };
            block.ops.push(op);
            routeHandlers.set(hit.handler, op);
            opOfDecl.set(hit.handler, { op, block });
          } else if (hit) {
            const target = this.declarationOf(hit.handler, checker);
            const found = target ? opOfDecl.get(target) : undefined;
            if (found && !found.op.tags.includes('api')) found.op.tags.push('api');
          }
        }
        ts.forEachChild(node, (c) => scan(c, f));
      };
      for (const f of block.files) scan(f.sf, f);
    }

    // ---- 4. Identity.
    const areaDirs = new Set<string>();
    for (const block of blocks) {
      let dir = block.dir === '.' ? '' : block.dir;
      while (dir.length > commonRoot.length) {
        if (dir !== primaryRoot) areaDirs.add(dir);
        dir = dir.includes('/') ? path.posix.dirname(dir) : '';
      }
    }
    const coreName = [...areaDirs].some((d) => path.posix.basename(d) === 'core') ? 'root' : 'core';
    const rootAreaEntity: Entity = { kind: 'area', path: primaryRoot || '.', name: coreName };
    const areaEntity = (dir: string): Entity => ({ kind: 'area', path: dir, name: '' });
    const systemEntity: Entity = { kind: 'system', path: '.', name: '' };
    const atRoot = (dir: string) => dir === commonRoot || dir === primaryRoot || dir === '.';
    const needsRootArea = blocks.some((b) => atRoot(b.dir));

    const entities: Entity[] = [
      systemEntity,
      ...[...areaDirs].map(areaEntity),
      ...(needsRootArea ? [rootAreaEntity] : []),
    ];
    for (const b of blocks)
      entities.push(b.entity, ...b.ops.map((o) => o.entity), ...b.data.map((d) => d.entity));
    const assigned = assignIds(entities, input.ids, input.renames ?? {});
    const idOf = assigned.idOf;

    // ---- 5. Nodes.
    const nodes: DeckNode[] = [];
    const systemId = idOf(systemEntity);
    nodes.push({
      id: systemId,
      kind: 'system',
      name: systemName,
      parentId: null,
      bullets: [],
      source: [],
      coverage: 'full',
    });
    const areaName = (dir: string) => {
      const words = path.posix
        .basename(dir)
        .split(/[-_.]+/)
        .join(' ');
      return humanize(words.replace(/ /g, '_'));
    };
    for (const dir of [...areaDirs].sort()) {
      const parentDir = dir.includes('/') ? path.posix.dirname(dir) : '';
      nodes.push({
        id: idOf(areaEntity(dir)),
        kind: 'area',
        name: areaName(dir),
        parentId: areaDirs.has(parentDir) ? idOf(areaEntity(parentDir)) : systemId,
        bullets: [],
        source: [{ path: dir, startLine: 1, endLine: 1, hash: '' }],
        coverage: 'full',
      });
    }
    if (needsRootArea) {
      nodes.push({
        id: idOf(rootAreaEntity),
        kind: 'area',
        name: humanize(coreName),
        parentId: systemId,
        bullets: [],
        source: [{ path: primaryRoot || '.', startLine: 1, endLine: 1, hash: '' }],
        coverage: 'full',
      });
    }

    const blockId = new Map<BlockDraft, Id>();
    const opId = new Map<OpDraft, Id>();
    for (const b of blocks) {
      blockId.set(b, idOf(b.entity));
      for (const o of b.ops) opId.set(o, idOf(o.entity));
    }

    // ---- 6. Calls, gaps, and externals.
    const edges = new Map<string, DeckEdge>();
    const gaps: Gap[] = [];
    const gapCount = new Map<BlockDraft, number>();
    const externals = new Map<string, Id>();
    const stats = { callSites: 0, resolvedCallSites: 0, imports: 0, resolvedImports: 0 };
    const projectFiles = new Set(files.map((f) => f.sf));

    const addEdge = (
      from: Id,
      to: Id,
      kind: EdgeKind,
      evidence: SourceRef | undefined,
      label?: string,
      indirect?: string,
    ) => {
      if (from === to) return;
      const id = hashId('edge', `${from}>${to}:${kind}`);
      const edge = edges.get(id);
      if (edge) {
        if (evidence && edge.evidence.length < 8) edge.evidence.push(evidence);
        return;
      }
      edges.set(id, {
        id,
        from,
        to,
        kind,
        label,
        indirect,
        bullets: [],
        evidence: evidence ? [evidence] : [],
      });
    };

    type Target = { id: Id; block: BlockDraft; op?: OpDraft; indirect?: string };
    /** What a call resolves to: project operations, something outside, or a gap. */
    const resolve = (
      call: ts.CallExpression | ts.NewExpression,
    ): { targets: Target[]; gap?: GapReason; counted: boolean } => {
      const expr = call.expression;
      if (expr.kind === ts.SyntaxKind.ImportKeyword) {
        return literalText(call.arguments?.[0])
          ? { targets: [], counted: true }
          : { targets: [], gap: 'dynamic-import', counted: true };
      }
      if (expr.kind === ts.SyntaxKind.SuperKeyword) return { targets: [], counted: false };
      if (ts.isIdentifier(expr) && expr.text === 'eval')
        return { targets: [], gap: 'unsupported', counted: true };
      if (ts.isElementAccessExpression(expr) && !literalText(expr.argumentExpression))
        return { targets: [], gap: 'dynamic-call', counted: true };
      const nameNode = ts.isPropertyAccessExpression(expr)
        ? expr.name
        : ts.isElementAccessExpression(expr)
          ? expr.argumentExpression
          : expr;
      if (!ts.isIdentifier(nameNode) && !ts.isPrivateIdentifier(nameNode) && !ts.isStringLiteral(nameNode))
        return { targets: [], counted: false };

      let symbol = checker.getSymbolAtLocation(nameNode);
      if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      const decl = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
      if (!decl) {
        const owner = ts.isPropertyAccessExpression(expr) ? expr.expression : expr;
        const any = (checker.getTypeAtLocation(owner).flags & ts.TypeFlags.Any) !== 0;
        return any ? { targets: [], gap: 'untyped', counted: true } : { targets: [], counted: false };
      }
      if (!projectFiles.has(decl.getSourceFile())) return { targets: [], counted: true };

      if (ts.isNewExpression(call) && ts.isClassDeclaration(decl)) {
        const block = blockOfClass.get(decl);
        return { targets: block ? [{ id: blockId.get(block)!, block }] : [], counted: true };
      }
      // A call through an interface goes to every implementation in the repository.
      if (
        (ts.isMethodSignature(decl) || ts.isPropertySignature(decl)) &&
        ts.isInterfaceDeclaration(decl.parent)
      ) {
        const targets: Target[] = [];
        for (const cls of implementers.get(decl.parent) ?? []) {
          const method = cls.members.find(
            (m) => ts.isMethodDeclaration(m) && m.name.getText() === decl.name.getText(),
          );
          const found = method ? opOfDecl.get(method) : undefined;
          if (found)
            targets.push({
              id: opId.get(found.op)!,
              block: found.block,
              op: found.op,
              indirect: `via ${decl.parent.name.text}`,
            });
        }
        return { targets, counted: true };
      }
      const found = opOfDecl.get(decl);
      if (found)
        return { targets: [{ id: opId.get(found.op)!, block: found.block, op: found.op }], counted: true };
      // Parameters, locals and properties holding functions: a value being invoked.
      if (
        ts.isParameter(decl) ||
        ts.isVariableDeclaration(decl) ||
        ts.isPropertyDeclaration(decl) ||
        ts.isPropertySignature(decl) ||
        ts.isBindingElement(decl)
      ) {
        const any = (checker.getTypeAtLocation(nameNode).flags & ts.TypeFlags.Any) !== 0;
        return any ? { targets: [], gap: 'untyped', counted: true } : { targets: [], counted: false };
      }
      return { targets: [], counted: true };
    };

    const walkCalls = (root: ts.Node, visit: (call: ts.CallExpression | ts.NewExpression) => void) => {
      const go = (node: ts.Node) => {
        if (node !== root && routeHandlers.has(node)) return;
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) visit(node);
        ts.forEachChild(node, go);
      };
      go(root);
    };

    const borrowed = new Map<OpDraft, OpDraft[]>();
    const scanBody = (block: BlockDraft, from: Id, body: ts.Node, op?: OpDraft) => {
      const f = fileOf(body);
      walkCalls(body, (call) => {
        const res = resolve(call);
        if (res.counted) {
          stats.callSites += 1;
          if (!res.gap) stats.resolvedCallSites += 1;
        }
        if (res.gap) {
          gaps.push({ ownerId: blockId.get(block)!, reason: res.gap, source: ref(f, call) });
          gapCount.set(block, (gapCount.get(block) ?? 0) + 1);
        }
        for (const t of res.targets) {
          const api = op?.tags.includes('api') && t.block !== block && t.op;
          addEdge(
            from,
            t.id,
            api ? 'api' : 'call',
            ref(f, call, op?.name),
            api ? humanize(t.op!.name.split('.').at(-1)!).toLowerCase() : undefined,
            t.indirect,
          );
          if (op && t.op && t.block !== block) borrowed.set(op, [...(borrowed.get(op) ?? []), t.op]);
        }
      });
    };
    for (const block of blocks) {
      for (const op of block.ops) if (op.body) scanBody(block, opId.get(op)!, op.body, op);
      for (const top of block.topLevel) scanBody(block, blockId.get(block)!, top.node);
    }
    // A thin route handler that calls one operation reads as that operation's behavior.
    for (const [op, targets] of borrowed) {
      if (!op.tags.includes('api') || !op.entity.name.startsWith('route:')) continue;
      const unique = [...new Set(targets)];
      if (unique.length === 1 && unique[0]!.doc) op.borrow = unique[0]!.doc;
    }

    // Imports: other blocks become data arrows, packages become externals.
    const blockForModule = (spec: ts.Expression): BlockDraft | 'external' | undefined => {
      const target = checker.getSymbolAtLocation(spec)?.declarations?.[0]?.getSourceFile();
      if (!target) return undefined;
      if (!projectFiles.has(target)) return 'external';
      const f = files.find((x) => x.sf === target);
      return f ? blockOfFile.get(f.rel) : undefined;
    };
    for (const block of blocks) {
      for (const f of block.files) {
        for (const st of f.sf.statements) {
          if (!(ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) || !st.moduleSpecifier) continue;
          const spec = literalText(st.moduleSpecifier);
          if (!spec) continue;
          stats.imports += 1;
          const target = blockForModule(st.moduleSpecifier);
          const relative = spec.startsWith('.') || spec.startsWith('/');
          if (target && target !== 'external') {
            stats.resolvedImports += 1;
            if (target !== block) addEdge(blockId.get(block)!, blockId.get(target)!, 'data', ref(f, st));
            continue;
          }
          if (relative) {
            // A relative import that resolves to a file outside the map (a barrel, a test helper) is fine.
            if (target === 'external' || checker.getSymbolAtLocation(st.moduleSpecifier))
              stats.resolvedImports += 1;
            else gaps.push({ ownerId: blockId.get(block)!, reason: 'parse-error', source: ref(f, st) });
            continue;
          }
          if (target === 'external') stats.resolvedImports += 1;
          const bare = spec.replace(/^node:/, '');
          const pkg =
            spec.startsWith('node:') || BUILTINS.has(bare.split('/')[0]!)
              ? `node:${bare.split('/')[0]}`
              : spec.startsWith('@')
                ? spec.split('/').slice(0, 2).join('/')
                : spec.split('/')[0]!;
          let extId = externals.get(pkg);
          if (!extId) {
            extId = hashId('external', pkg);
            externals.set(pkg, extId);
          }
          addEdge(blockId.get(block)!, extId, 'dependency', ref(f, st));
        }
      }
    }

    // A service reached without a package, by a plain fetch, leaves no import to see. The
    // code can say so itself: a doc comment with `@service Supabase` puts it on the map.
    for (const block of blocks) {
      for (const f of block.files) {
        for (const st of f.sf.statements) {
          for (const tag of ts.getJSDocTags(st)) {
            if (tag.tagName.text !== 'service') continue;
            const name = ts.getTextOfJSDocComment(tag.comment)?.trim().split(/\s+/)[0];
            if (!name) continue;
            let extId = externals.get(name);
            if (!extId) {
              extId = hashId('external', name);
              externals.set(name, extId);
            }
            addEdge(blockId.get(block)!, extId, 'dependency', ref(f, st));
          }
        }
      }
    }

    // ---- 7. Emit blocks, operations and data.
    const parentOf = (block: BlockDraft): Id => {
      const dir = block.dir === '.' ? '' : block.dir;
      if (areaDirs.has(dir)) return idOf(areaEntity(dir));
      return needsRootArea ? idOf(rootAreaEntity) : systemId;
    };
    for (const block of [...blocks].sort((a, b) => a.entity.path.localeCompare(b.entity.path))) {
      const id = blockId.get(block)!;
      const main = block.files.find((f) => noExt(f.rel) === block.entity.path) ?? block.files[0]!;
      const count = gapCount.get(block) ?? 0;
      nodes.push({
        id,
        kind: 'block',
        name: block.name,
        parentId: parentOf(block),
        summary: block.summary
          ? {
              id: hashId('bullet', `${id}:summary`),
              text: block.summary.text,
              origin: 'declared',
              basis: 'doc',
              derivedFrom: ref(block.summary.sf, block.summary.node),
            }
          : undefined,
        bullets: [],
        source: block.files
          .map((f) => ({
            path: f.rel,
            startLine: 1,
            endLine: f.sf.getLineAndCharacterOfPosition(f.sf.getEnd()).line + 1,
            hash: sha(f.sf.text),
          }))
          .sort((a, b) =>
            a.path === main.rel ? -1 : b.path === main.rel ? 1 : a.path.localeCompare(b.path),
          ),
        coverage: count > 0 ? 'partial' : 'full',
        tags: block.topLevel.some(
          (t) => ts.isExpressionStatement(t.node) && ts.isCallExpression(t.node.expression),
        )
          ? ['entry']
          : undefined,
      });
      const ordered = [...block.ops].sort((a, b) => {
        const fa = fileOf(a.decl).rel;
        const fb = fileOf(b.decl).rel;
        return fa === fb
          ? a.decl.getStart() - b.decl.getStart()
          : fa === main.rel
            ? -1
            : fb === main.rel
              ? 1
              : fa.localeCompare(fb);
      });
      for (const op of ordered) {
        const oid = opId.get(op)!;
        const f = fileOf(op.decl);
        const source = ref(f, op.decl, op.name);
        const bullets: Bullet[] = [];
        const doc = op.doc ?? op.borrow;
        if (doc)
          bullets.push({
            id: hashId('bullet', `${oid}:doc`),
            text: doc,
            origin: 'declared',
            basis: 'doc',
            derivedFrom: source,
          });
        bullets.push({
          id: hashId('bullet', `${oid}:name`),
          text: op.entity.name.startsWith('route:') ? op.name : humanize(op.name.split('.').at(-1)!),
          origin: 'declared',
          basis: 'name',
          derivedFrom: source,
        });
        nodes.push({
          id: oid,
          kind: 'operation',
          name: op.name,
          parentId: id,
          bullets,
          signature: op.signature,
          source: [source],
          coverage: 'full',
          tags: op.tags.length ? [...op.tags].sort() : undefined,
        });
      }
      for (const d of [...block.data].sort((a, b) => a.decl.getStart() - b.decl.getStart())) {
        nodes.push({
          id: idOf(d.entity),
          kind: 'data',
          name: d.name,
          parentId: id,
          bullets: [],
          signature: d.signature,
          source: [ref(d.sf, d.decl, d.name)],
          coverage: 'full',
        });
      }
    }
    for (const [pkg, id] of [...externals].sort(([a], [b]) => a.localeCompare(b))) {
      nodes.push({
        id,
        kind: 'external',
        name: pkg,
        parentId: systemId,
        bullets: [],
        source: [],
        coverage: 'full',
      });
    }

    // ---- 8. Tests: each hangs off the operations its body calls directly.
    const deckTests: DeckTest[] = [];
    const seenTests = new Set<string>();
    for (const f of tests) {
      const imported = new Set<BlockDraft>();
      for (const st of f.sf.statements) {
        if (!ts.isImportDeclaration(st)) continue;
        const target = blockForModule(st.moduleSpecifier);
        if (target && target !== 'external') imported.add(target);
      }
      const sibling = sources.find((s) => noExt(s.rel) === f.rel.replace(/\.(test|spec)\.[cm]?[jt]sx?$/, ''));
      const visit = (node: ts.Node, suite: string[]) => {
        if (ts.isCallExpression(node)) {
          const base = baseIdentifier(node.expression);
          const title = literalText(node.arguments[0]);
          if (base === 'describe' && title !== undefined) {
            for (const arg of node.arguments.slice(1)) visit(arg, [...suite, title]);
            return;
          }
          if ((base === 'it' || base === 'test') && title !== undefined) {
            const body = node.arguments.find(isFunctionLike);
            const targets = new Map<Id, 'calls' | 'imports' | 'name'>();
            if (body) {
              walkCalls(body, (call) => {
                for (const t of resolve(call).targets) targets.set(t.id, 'calls');
              });
            }
            if (targets.size === 0) for (const b of imported) targets.set(blockId.get(b)!, 'imports');
            if (targets.size === 0 && sibling) {
              const b = blockOfFile.get(sibling.rel);
              if (b) targets.set(blockId.get(b)!, 'name');
            }
            let key = `${f.rel}#${[...suite, title].join('/')}`;
            for (let n = 2; seenTests.has(key); n++) key = `${f.rel}#${[...suite, title].join('/')}~${n}`;
            seenTests.add(key);
            deckTests.push({
              id: hashId('test', key),
              name: title,
              suite,
              source: ref(f, node),
              targets: [...targets]
                .map(([id, via]) => ({ id, via }))
                .sort((a, b) => a.id.localeCompare(b.id)),
            });
            return;
          }
        }
        ts.forEachChild(node, (c) => visit(c, suite));
      };
      visit(f.sf, []);
    }

    const snapshot: DeckSnapshot = {
      schemaVersion: 1,
      sourceCommit: input.commit,
      dirty: input.dirty,
      adapter: { name: 'typescript', version: ADAPTER_VERSION, configHash: this.configHash },
      nodes,
      edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
      tests: deckTests,
      gaps: gaps.sort(
        (a, b) => a.source.path.localeCompare(b.source.path) || a.source.startLine - b.source.startLine,
      ),
      stats: {
        files: files.length,
        lines: files.reduce((n, f) => n + f.sf.getLineAndCharacterOfPosition(f.sf.getEnd()).line + 1, 0),
        ...stats,
      },
    };
    snapshotSchema.parse(snapshot);
    return {
      snapshot,
      ids: assigned.ids,
      suggestions: assigned.suggestions,
      ms: Math.round(performance.now() - started),
    };
  }

  /** Names a barrel index re-exports from its directory. */
  private reexports(members: FileInfo[], checker: ts.TypeChecker): Set<string> {
    const names = new Set<string>();
    const index = members.find((f) => /^index$/.test(noExt(path.posix.basename(f.rel))));
    const symbol = index ? checker.getSymbolAtLocation(index.sf) : undefined;
    if (symbol) for (const e of checker.getExportsOfModule(symbol)) names.add(e.name);
    return names;
  }

  private declarationOf(node: ts.Node, checker: ts.TypeChecker): ts.Node | undefined {
    const name = ts.isPropertyAccessExpression(node) ? node.name : node;
    let symbol = checker.getSymbolAtLocation(name);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  }
}

/** Directories worth watching: everything under the root that can hold source. */
export function watchRoots(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() && !['node_modules', '.git', '.deck', 'dist', 'build', 'coverage'].includes(d.name),
    )
    .map((d) => path.join(root, d.name));
}
