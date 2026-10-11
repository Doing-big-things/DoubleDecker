// Identity (spec §4.2). Ids are opaque and assigned the first time an entity is seen.
// Names, paths and line numbers are attributes that can change.
import { hashId, type Id } from '@decker/deck-model';

export interface IdsFile {
  version: 1;
  /** id -> "kind:key", where the key is the module path and exported name. */
  bindings: Record<Id, string>;
  /** Ids whose entity is gone, kept so they are never reused. */
  tombstones: Record<Id, string>;
  /** Operation id -> hash of its signature and body, for spotting renames. */
  shapes: Record<Id, string>;
}

export const emptyIds = (): IdsFile => ({ version: 1, bindings: {}, tombstones: {}, shapes: {} });

export interface Entity {
  kind: string;
  /** Module path, without extension, relative to the repository root. */
  path: string;
  /** Exported name inside the module; empty for the module itself. */
  name: string;
  shape?: string;
}

export interface RenameSuggestion {
  id: Id; // the id the entity had
  from: string;
  to: string;
  newId: Id; // the id it would otherwise get
}

const fullKey = (e: Entity): string => `${e.kind}:${e.path}${e.name ? `#${e.name}` : ''}`;

export interface Assignment {
  idOf: (e: Entity) => Id;
  ids: IdsFile;
  suggestions: RenameSuggestion[];
}

/**
 * Match entities to ids, in order: an existing binding; a file git reports as renamed
 * with the same exported name; otherwise a new id. The same shape under a new name is
 * only suggested as a rename, for the engineer to confirm.
 */
export function assignIds(entities: Entity[], prev: IdsFile, renames: Record<string, string>): Assignment {
  const prevByKey = new Map<string, Id>();
  for (const [id, key] of Object.entries(prev.bindings)) prevByKey.set(key, id);
  const newToOld = new Map<string, string>();
  for (const [oldPath, newPath] of Object.entries(renames)) newToOld.set(strip(newPath), strip(oldPath));

  const current = new Set(entities.map(fullKey));
  const used = new Set<Id>([...Object.keys(prev.bindings), ...Object.keys(prev.tombstones)]);
  const bindings: Record<Id, string> = {};
  const shapes: Record<Id, string> = {};
  const byKey = new Map<string, Id>();
  const fresh: { e: Entity; id: Id }[] = [];

  const sorted = [...entities].sort((a, b) => fullKey(a).localeCompare(fullKey(b)));
  for (const e of sorted) {
    const key = fullKey(e);
    if (byKey.has(key)) continue;
    let id = prevByKey.get(key);
    if (!id) {
      // A renamed file keeps the ids of everything in it.
      for (const [newPath, oldPath] of newToOld) {
        if (e.path !== newPath && !e.path.startsWith(`${newPath}/`)) continue;
        const oldKey = fullKey({ ...e, path: oldPath + e.path.slice(newPath.length) });
        const old = prevByKey.get(oldKey);
        if (old && !current.has(oldKey) && !bindings[old]) id = old;
      }
    }
    if (!id) {
      let salt = 0;
      id = hashId(e.kind, key.slice(e.kind.length + 1));
      while (used.has(id)) id = hashId(e.kind, `${key.slice(e.kind.length + 1)}~${++salt}`);
      fresh.push({ e, id });
    }
    used.add(id);
    bindings[id] = key;
    byKey.set(key, id);
    if (e.shape) shapes[id] = e.shape;
  }

  const tombstones: Record<Id, string> = { ...prev.tombstones };
  const gone: { id: Id; key: string }[] = [];
  for (const [id, key] of Object.entries(prev.bindings)) {
    if (bindings[id]) continue;
    tombstones[id] = key;
    gone.push({ id, key });
  }
  for (const id of Object.keys(bindings)) delete tombstones[id];

  const suggestions: RenameSuggestion[] = [];
  for (const { e, id } of fresh) {
    if (!e.shape) continue;
    const match = gone.find((g) => prev.shapes[g.id] === e.shape && g.key.startsWith(`${e.kind}:`));
    if (match) suggestions.push({ id: match.id, from: match.key, to: fullKey(e), newId: id });
  }

  return {
    idOf: (e) => byKey.get(fullKey(e))!,
    ids: {
      version: 1,
      bindings: sortRecord(bindings),
      tombstones: sortRecord(tombstones),
      shapes: sortRecord(shapes),
    },
    suggestions,
  };
}

/** Accept a suggested rename: the new key takes over the old id. */
export function confirmRename(ids: IdsFile, s: RenameSuggestion): IdsFile {
  const bindings = { ...ids.bindings };
  const tombstones = { ...ids.tombstones };
  const shapes = { ...ids.shapes };
  delete bindings[s.newId];
  delete tombstones[s.id];
  if (shapes[s.newId]) shapes[s.id] = shapes[s.newId]!;
  delete shapes[s.newId];
  bindings[s.id] = s.to;
  return {
    version: 1,
    bindings: sortRecord(bindings),
    tombstones: sortRecord(tombstones),
    shapes: sortRecord(shapes),
  };
}

function strip(path: string): string {
  return path.replace(/\\/g, '/').replace(/\.(d\.)?[cm]?[jt]sx?$/, '');
}

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}
