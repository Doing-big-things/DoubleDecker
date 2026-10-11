import type { Sku } from '../shared/types';
import type { StockLevel, StockStore } from './stock-store';

export interface SupabaseConfig {
  /** The project's URL. A trailing /rest/v1 is ignored. */
  url: string;
  /** A key allowed to read and write the bucket. */
  key: string;
  bucket?: string;
  /** Keeps one shop's stock apart from another's in the same bucket. */
  prefix?: string;
}

const BUCKET = 'decker-shop-stock';
const TIMEOUT_MS = 8000;

function endpoint(config: SupabaseConfig): { storage: string; bucket: string; object: string } {
  const base = config.url.replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  const bucket = config.bucket ?? BUCKET;
  return {
    storage: `${base}/storage/v1`,
    bucket,
    object: `${base}/storage/v1/object/${bucket}/${config.prefix ?? 'shop'}/levels.json`,
  };
}

function send(config: SupabaseConfig, url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { apikey: config.key, authorization: `Bearer ${config.key}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** Whether the project answers at all. A paused or unreachable project does not. */
export async function reachable(config: SupabaseConfig): Promise<boolean> {
  try {
    return (await send(config, `${endpoint(config).storage}/bucket`)).ok;
  } catch {
    return false;
  }
}

/**
 * Keeps stock in a Supabase Storage bucket, so it survives a restart.
 *
 * Reads are answered from memory. A write is saved in the background, and `flush` waits for it.
 *
 * @service Supabase
 */
export class SupabaseStockStore implements StockStore {
  private levels = new Map<Sku, number>();
  private saving: Promise<void> = Promise.resolve();
  private failure: Error | null = null;
  private config: SupabaseConfig;

  private constructor(config: SupabaseConfig) {
    this.config = config;
  }

  /** Open the store, reading every stock level saved so far. */
  static async open(config: SupabaseConfig): Promise<SupabaseStockStore> {
    const store = new SupabaseStockStore(config);
    const at = endpoint(config);
    const made = await send(config, `${at.storage}/bucket`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: at.bucket, name: at.bucket, public: false }),
    });
    // The bucket being there already is the usual case.
    if (!made.ok && !/exist|duplicate/i.test(await made.text()))
      throw new Error(`The stock bucket could not be created (${made.status})`);
    const res = await send(config, at.object);
    if (res.ok) {
      const saved = (await res.json()) as Record<Sku, number>;
      for (const [sku, units] of Object.entries(saved)) store.levels.set(sku, units);
    } else if (res.status >= 500) throw new Error(`Stock levels could not be read (${res.status})`);
    return store;
  }

  /** Remove everything this store has saved. */
  static async erase(config: SupabaseConfig): Promise<void> {
    await send(config, endpoint(config).object, { method: 'DELETE' });
  }

  read(sku: Sku): StockLevel {
    return { sku, units: this.levels.get(sku) ?? 0 };
  }

  write(sku: Sku, units: number): void {
    this.levels.set(sku, units);
    this.saving = this.saving
      .then(() => this.save())
      .catch((err: unknown) => {
        this.failure = err instanceof Error ? err : new Error(String(err));
      });
  }

  /** Wait until every write so far is saved. Throws if one could not be. */
  async flush(): Promise<void> {
    await this.saving;
    if (!this.failure) return;
    const failure = this.failure;
    this.failure = null;
    throw failure;
  }

  private async save(): Promise<void> {
    const res = await send(this.config, endpoint(this.config).object, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-upsert': 'true' },
      body: JSON.stringify(Object.fromEntries(this.levels)),
    });
    if (!res.ok) throw new Error(`Stock levels could not be saved (${res.status})`);
  }
}
