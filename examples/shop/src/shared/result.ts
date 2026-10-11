/** Success with a value, or failure with every problem found. */
export type Result<T> = { ok: true; value: T } | { ok: false; problems: string[] };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T>(problems: string[]): Result<T> {
  return { ok: false, problems };
}
