/** A failure the HTTP layer knows how to report. */
export class ShopError extends Error {
  readonly code: 'not_found' | 'invalid' | 'conflict';

  constructor(code: ShopError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export function notFound(what: string): ShopError {
  return new ShopError('not_found', `${what} was not found`);
}

export function invalid(problem: string): ShopError {
  return new ShopError('invalid', problem);
}

export function conflict(problem: string): ShopError {
  return new ShopError('conflict', problem);
}
