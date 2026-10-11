let counter = 0;

/** Make an identifier that sorts by creation order. */
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${String(counter).padStart(6, '0')}`;
}

/** Start counting again, between tests. */
export function resetIds(): void {
  counter = 0;
}
