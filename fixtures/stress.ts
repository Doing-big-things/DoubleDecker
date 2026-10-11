// The generated stress fixture: about 1,500 blocks and 4,000 arrows (spec §10).
import type { DeckBundle } from '@decker/deck-model';
import { type BlockSpec, DeckBuilder, op } from './dsl.ts';

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DOMAINS = ['Billing', 'Accounts', 'Search', 'Messaging', 'Reports', 'Shipping', 'Identity', 'Media', 'Ledger', 'Pricing', 'Audit', 'Scheduling', 'Gateway', 'Storage', 'Insights', 'Support', 'Catalog', 'Checkout', 'Risk', 'Notifications', 'Workflow', 'Imports', 'Exports', 'Platform'];
const PARTS = ['Core', 'Rules', 'Store', 'Api', 'Jobs', 'Views'];
const NOUNS = ['Invoice', 'Session', 'Token', 'Queue', 'Batch', 'Policy', 'Cache', 'Index', 'Draft', 'Quota', 'Rate', 'Plan', 'Route', 'Lease', 'Shard', 'Report', 'Digest', 'Cursor', 'Bucket', 'Ticket'];
const ROLES = ['Service', 'Repository', 'Validator', 'Mapper', 'Scheduler', 'Client', 'Planner', 'Reader', 'Writer', 'Resolver', 'Monitor', 'Builder'];
const VERBS = ['create', 'find', 'update', 'remove', 'list', 'validate', 'schedule', 'resolve', 'merge', 'publish', 'archive', 'rebuild'];

export function buildStress(blockTarget = 1500, edgeTarget = 4000): DeckBundle {
  const rand = mulberry32(20261011);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
  const d = new DeckBuilder('stress');

  const perArea = Math.ceil(blockTarget / (DOMAINS.length * PARTS.length));
  const names: string[] = [];
  const opsOf = new Map<string, string[]>();
  const plan: { domain: string; part: string; name: string; spec: BlockSpec }[] = [];

  for (const domain of DOMAINS) {
    for (const part of PARTS) {
      for (let i = 0; i < perArea && names.length < blockTarget; i++) {
        let name = `${domain}${pick(NOUNS)}${pick(ROLES)}`;
        while (opsOf.has(name)) name = `${domain}${pick(NOUNS)}${pick(ROLES)}${Math.floor(rand() * 90 + 10)}`;
        const verbs = new Set<string>();
        const count = 2 + Math.floor(rand() * 4);
        while (verbs.size < count) verbs.add(pick(VERBS));
        opsOf.set(name, [...verbs]);
        names.push(name);
        plan.push({
          domain,
          part,
          name,
          spec: {
            summary: `Handles ${part.toLowerCase()} work for ${domain.toLowerCase()}`,
            path: `src/${domain.toLowerCase()}/${part.toLowerCase()}/${name}.ts`,
            ran: rand() > 0.3,
            ops: [...verbs].map((v) => op(`${v}(input: Input): Output`, '~', { calls: [], tests: rand() > 0.5 ? [`${v}s the input`, `rejects a bad input`] : [] })),
          },
        });
      }
    }
  }

  // Arrows point mostly "down" the list so the layered layout has a direction to follow.
  let edges = 0;
  while (edges < edgeTarget) {
    const i = Math.floor(rand() * plan.length);
    const near = rand() < 0.7;
    const span = near ? perArea * PARTS.length : plan.length;
    const j = Math.min(plan.length - 1, i + 1 + Math.floor(rand() * span));
    if (i === j) continue;
    const from = plan[i]!;
    const to = plan[j]!;
    const target = `${to.name}.${pick(opsOf.get(to.name)!)}`;
    const source = pick(from.spec.ops);
    if (source.calls!.includes(target)) continue;
    source.calls!.push(target);
    edges += 1;
  }

  for (const domain of DOMAINS) {
    d.area(domain, () => {
      for (const part of PARTS) {
        d.area(part, () => {
          for (const p of plan) if (p.domain === domain && p.part === part) d.block(p.name, p.spec);
        });
      }
    });
  }
  const bundle = d.build();
  bundle.sources = undefined; // not needed for a performance fixture, and large
  return bundle;
}
