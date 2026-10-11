// Writes the M0 fixtures: fixtures/shop.graph.json (committed, the design fixture)
// and the generated stress fixture, plus copies the web app can load with no server.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, snapshotSchema } from '@decker/deck-model';
import { buildShop } from './shop.ts';
import { buildStress } from './stress.ts';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'packages', 'web', 'public', 'fixtures');
mkdirSync(publicDir, { recursive: true });

const fixtures = { shop: buildShop(), mid: buildStress(300, 600, 'mid', 8), stress: buildStress() };

for (const [name, bundle] of Object.entries(fixtures)) {
  snapshotSchema.parse(bundle.snapshot);
  const index = buildIndex(bundle.snapshot);
  const pretty = name === 'shop';
  const json = JSON.stringify(bundle, null, pretty ? 1 : undefined);
  if (pretty) writeFileSync(join(here, `${name}.graph.json`), json);
  writeFileSync(join(publicDir, `${name}.graph.json`), JSON.stringify(bundle));
  console.log(
    `${name}: ${index.areas.length} areas, ${index.blocks.length} blocks, ${index.links.length} arrows, ` +
      `${bundle.snapshot.tests.length} tests, ${(json.length / 1024).toFixed(0)} KB`,
  );
}
