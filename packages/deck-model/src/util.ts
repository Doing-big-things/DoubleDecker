/** FNV-1a, 32 bit, as 8 hex characters. Small, stable, and the same in Node and the browser. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const PREFIX: Record<string, string> = {
  system: 'sys',
  area: 'area',
  block: 'blk',
  operation: 'op',
  data: 'dat',
  external: 'ext',
  edge: 'edg',
  bullet: 'bul',
  test: 'tst',
  op: 'cop',
  change: 'chg',
};

/** A deterministic id for the first time an entity is seen. */
export function hashId(kind: string, key: string): string {
  return `${PREFIX[kind] ?? kind}_${fnv1a(`${kind}:${key}`)}`;
}

let counter = 0;
/** A fresh id for things the engineer creates on the map. */
export function freshId(kind: string): string {
  counter += 1;
  const rand = Math.floor(Math.random() * 0xffffffff).toString(16);
  return `${PREFIX[kind] ?? kind}_${fnv1a(`${Date.now()}:${counter}:${rand}`)}`;
}

const ACRONYMS = new Set(['api', 'http', 'https', 'url', 'uri', 'id', 'json', 'jwt', 'sql', 'html', 'css', 'ui', 'sse', 'jsx', 'ws', 'cors', 'csrf', 'etag', 'ip', 'db']);

/** Split an identifier into lower-case words: reserveStock -> ["reserve", "stock"]. */
export function splitIdentifier(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-.$]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/** reserveStock -> "Reserve stock"; getHTTPStatus -> "Get HTTP status". */
export function humanize(name: string): string {
  const words = splitIdentifier(name).map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w));
  if (words.length === 0) return name;
  const first = words[0]!;
  words[0] = first.charAt(0).toUpperCase() + first.slice(1);
  return words.join(' ');
}

/** The first sentence of a doc comment, without a trailing period. */
export function firstSentence(doc: string): string {
  const flat = doc.replace(/\s+/g, ' ').trim();
  const m = flat.match(/^(.*?[.!?])(\s|$)/);
  const s = (m ? m[1]! : flat).trim();
  return s.replace(/\.$/, '');
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
