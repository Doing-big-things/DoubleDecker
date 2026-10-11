# Double Decker

A programming system with two connected decks, like a double-decker bus.

- The **lower deck** is ordinary source code. AI agents do most of the work there.
- The **upper deck** is a code-free map generated from that code: areas, blocks with a name and a few bullets, and arrows. You pan, zoom and drill into it, all the way down to the source a block represents.

Edit the map (change a bullet, add a block, draw an arrow) and each edit becomes a task for an agent. The agent's result comes back as a visual diff on the same map, with evidence, for you to accept, revise or reject.

The full design is in [double_decker_spec.md](double_decker_spec.md). This repository is the proof of concept it describes.

## Try it

Requires Node 24 and git.

```bash
npm install
npm run build
```

**The map on its own**, on a hand-written fixture, with no server:

```bash
npm run preview -w @decker/web
```

Open http://localhost:4173. Add `?fixture=stress` for the 1,500-block stress map.

**The whole loop**, on the reference service in `examples/shop`:

```bash
node packages/server/bin/decker.mjs examples/shop --sandbox host
```

That maps the service and opens the browser. Then:

1. Drag from the edge of the **Orders** block to **Inventory**. Pick **API**, label it "Reserve stock", and add a few bullets.
2. Open **Changes** and press **Submit**. Answer the plan's two questions and approve it.
3. Review candidate 1. A harness-run test shows it reserves only part of an order, so the requirement is marked **Contradicted** and Accept is disabled.
4. Press **Revise**. Candidate 2 passes. **Accept** merges it, and the arrow becomes part of the map.

The reference service ships with stored candidates, so this demo needs no API key and always plays out the same way. To map any other TypeScript repository, run `decker <path-to-repo>`.

`--sandbox host` runs checks and agent commands directly on your machine, with no isolation. It exists because the default sandbox needs Docker or Podman. See "What is not verified" below.

## Around the map

| | |
|---|---|
| Pan | Drag the canvas, or Shift + arrows |
| Zoom at the cursor | Mouse wheel or pinch, `+` / `-` |
| Fit everything | `0` |
| Search and fly | `Ctrl+K` |
| Expand a block | `Enter`, or its chevron |
| A block's tests | `T`, or the chip in its title row. `Shift+T` opens them all |
| Up one level | `Esc` |
| Outline view | `Ctrl+\` |
| Open in editor | `Ctrl+Enter` |
| New block, rename, remove | `N`, `F2`, `Delete` |
| Undo, redo | `Ctrl+Z`, `Ctrl+Shift+Z` |
| All shortcuts | `?` |

## What is in here

```text
packages/
  deck-model/          the deck's types, schemas, and the deck text outline
  adapter-typescript/  compile up: extracts a deck from a TypeScript project
  core/                git and worktrees, sandboxes, the check harness, reconciliation, the change coordinator
  agent-gateway/       the worker interface, the stored-candidate worker, the Claude worker, summaries
  server/              the local server and the `decker` command
  web/                 the upper deck
examples/shop/         the reference service, with stored demo candidates under demo/
fixtures/              the hand-written design fixture and the stress fixture generator
e2e/                   end-to-end tests
```

## Tests

All tests are end to end. They drive the real UI in the installed Edge browser: the fixture tests against a static build, the rest against a real `decker` server on a throwaway copy of the reference service.

```bash
npm run build
npm run e2e
```

| Suite | Covers |
|---|---|
| `e2e/canvas.spec.ts` | Zoom levels, the 11 px text floor, drilling in, tests chips, search, keyboard, outline, themes, every editing gesture, and the performance budgets |
| `e2e/compile-up.spec.ts` | The real map, source peek and open-in-editor, harness-run test status, identical snapshots, live updates, identity across renames, summaries |
| `e2e/change-loop.spec.ts` | The demo from request to acceptance, unrequested edits, deleted tests, parallel changes with a rebase, revert, and a server stopped mid-run |

`node e2e/tour.mjs <dir>` saves screenshots of each stage of the demo.

## What is not verified

These parts are written and are not exercised by any test, because of what the development machine has:

- **The container sandbox.** The machine has no Docker or Podman. Every change-loop test runs in `--sandbox host` mode, so the code that runs Prepare, Implement and Check in containers with the network off has never executed.
- **The Claude worker.** It uses the Claude Agent SDK, with file tools confined to the worktree and commands routed through the sandbox. No test calls a real model. The loop is tested with the stored-candidate worker.
- **Hostile-instruction tests** (spec M4). They need both of the above.
- **The test database** (spec §9.3) is not wired in. `TestDB.env` is git-ignored and nothing reads it.

Other gaps against the spec are listed in its "Build status" section.

## Credits

The canvas is built on [React Flow](https://reactflow.dev) and laid out with [ELK](https://eclipse.dev/elk/). Extraction uses the TypeScript compiler through [ts-morph](https://ts-morph.com).
