// The integration tier: the Supabase store against a real project (spec §9.3).
// The harness passes SUPABASE_TEST_URL and SUPABASE_TEST_KEY to this check and to no other.
import { afterAll, describe, expect, it } from 'vitest';
import { reachable, type SupabaseConfig, SupabaseStockStore } from './supabase-stock-store';

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_KEY;
// A project that is paused, unreachable or not configured skips these tests. It never fails them.
const up = url && key ? await reachable({ url, key }) : false;

describe.skipIf(!up)('SupabaseStockStore', () => {
  const config: SupabaseConfig = {
    url: url ?? '',
    key: key ?? '',
    prefix: `itest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  };
  afterAll(() => SupabaseStockStore.erase(config));

  it('reads zero for a product it has never seen', async () => {
    const store = await SupabaseStockStore.open(config);
    expect(store.read('mug').units).toBe(0);
  });

  it('keeps a stock level across a restart', async () => {
    const before = await SupabaseStockStore.open(config);
    before.write('mug', 7);
    await before.flush();
    const after = await SupabaseStockStore.open(config);
    expect(after.read('mug')).toEqual({ sku: 'mug', units: 7 });
  });

  it('saves the last of several quick writes', async () => {
    const before = await SupabaseStockStore.open(config);
    for (const units of [1, 2, 3]) before.write('plate', units);
    await before.flush();
    const after = await SupabaseStockStore.open(config);
    expect(after.read('plate').units).toBe(3);
  });
});
