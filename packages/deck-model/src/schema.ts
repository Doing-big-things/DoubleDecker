import { z } from 'zod';

const id = z.string().min(1);

export const sourceRefSchema = z.object({
  path: z.string(),
  symbol: z.string().optional(),
  startLine: z.number().int(),
  endLine: z.number().int(),
  hash: z.string(),
});

export const bulletSchema = z.object({
  id,
  text: z.string(),
  origin: z.enum(['declared', 'summarized', 'authored']),
  basis: z.enum(['doc', 'name']).optional(),
  derivedFrom: sourceRefSchema.optional(),
});

export const edgeKindSchema = z.enum(['call', 'api', 'event', 'data', 'dependency']);

export const nodeSchema = z.object({
  id,
  kind: z.enum(['system', 'area', 'block', 'operation', 'data', 'external']),
  name: z.string(),
  parentId: id.nullable(),
  summary: bulletSchema.optional(),
  bullets: z.array(bulletSchema),
  signature: z.string().optional(),
  source: z.array(sourceRefSchema),
  coverage: z.enum(['full', 'partial', 'opaque']),
  tags: z.array(z.string()).optional(),
});

export const edgeSchema = z.object({
  id,
  from: id,
  to: id,
  kind: edgeKindSchema,
  label: z.string().optional(),
  indirect: z.string().optional(),
  bullets: z.array(bulletSchema),
  evidence: z.array(sourceRefSchema),
});

export const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  sourceCommit: z.string(),
  dirty: z.boolean(),
  adapter: z.object({ name: z.string(), version: z.string(), configHash: z.string() }),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
  tests: z.array(
    z.object({
      id,
      name: z.string(),
      suite: z.array(z.string()),
      source: sourceRefSchema,
      targets: z.array(z.object({ id, via: z.enum(['calls', 'imports', 'name']) })),
    }),
  ),
  gaps: z.array(
    z.object({
      ownerId: id,
      reason: z.enum(['dynamic-call', 'dynamic-import', 'untyped', 'parse-error', 'unsupported']),
      source: sourceRefSchema,
    }),
  ),
  stats: z
    .object({
      files: z.number(),
      lines: z.number(),
      callSites: z.number(),
      resolvedCallSites: z.number(),
      imports: z.number(),
      resolvedImports: z.number(),
    })
    .optional(),
});

const point = z.object({ x: z.number(), y: z.number() });

export const layoutSchema = z.object({
  version: z.literal(1),
  positions: z.record(z.string(), point),
  pinned: z.array(id),
});

export const notesSchema = z.object({
  version: z.literal(1),
  bullets: z.record(z.string(), z.array(bulletSchema)),
  dismissed: z.array(id),
});

const shortText = z.string().trim().min(1).max(400);

export const changeOpSchema = z.discriminatedUnion('type', [
  z.object({
    id,
    type: z.literal('set_behavior'),
    targetId: id,
    bulletId: id,
    text: shortText,
    before: z.string(),
  }),
  z.object({ id, type: z.literal('add_behavior'), targetId: id, text: shortText }),
  z.object({
    id,
    type: z.literal('add_edge'),
    from: id,
    to: id,
    kind: edgeKindSchema,
    label: z.string().max(120).optional(),
    bullets: z.array(shortText),
  }),
  z.object({
    id,
    type: z.literal('add_block'),
    parentId: id,
    name: z.string().trim().min(1).max(80),
    bullets: z.array(shortText),
    position: point.optional(),
  }),
  z.object({
    id,
    type: z.literal('rename'),
    targetId: id,
    name: z.string().trim().min(1).max(80),
    before: z.string(),
  }),
  z.object({
    id,
    type: z.literal('remove'),
    targetId: id,
    targetType: z.enum(['node', 'edge', 'bullet']),
    ownerId: id.optional(),
    label: z.string(),
  }),
]);

export const changePatchSchema = z.object({
  title: z.string().max(160).optional(),
  operations: z.array(changeOpSchema).optional(),
});

export const planPatchSchema = z.object({
  interpretation: z.string().optional(),
  requirements: z
    .array(
      z.object({
        id,
        text: z.string(),
        opId: id.optional(),
        test: z.string().optional(),
        waived: z.string().optional(),
      }),
    )
    .optional(),
  answers: z.record(z.string(), z.string()).optional(),
});
