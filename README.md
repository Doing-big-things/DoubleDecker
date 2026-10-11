# Double Decker

A programming system with two connected decks, like a double-decker bus.

- The **lower deck** is ordinary source code. AI agents do most of the work there.
- The **upper deck** is a code-free map generated from that code: areas, blocks with a name and a few bullets, and arrows. You pan, zoom and drill into it, all the way down to the source a block represents.

Edit the map (change a bullet, add a block, draw an arrow) and each edit becomes a task for an agent. The agent's result comes back as a visual diff on the same map, with evidence, for you to accept, revise or reject.

The full design is in [double_decker_spec.md](double_decker_spec.md). This repository is the proof of concept it describes. The spec's "Build status" section says what is built, what has been verified and how, and what has not.

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

Open http://localhost:4173. Add `?fixture=mid` for a 300-block map or `?fixture=stress` for a 1,500-block one.

**The whole loop**, on the reference service:

```bash
npm run demo
```

That copies `examples/shop` into a scratch git repository under `.demo/`, maps it, and opens the browser. Accepting a change commits to that copy, never to this repository, and every run starts clean. Then:

1. Drag from the edge of the **Orders** block to **Inventory**. Pick **API**, label it "Reserve stock", and add a few bullets.
2. Open **Changes** and press **Submit**. Answer the plan's two questions and approve it.
3. Review candidate 1. A harness-run test shows it reserves only part of an order, so the requirement is marked **Contradicted** and Accept is disabled.
4. Press **Revise**. Candidate 2 passes. **Accept** merges it, and the arrow becomes part of the map.

The reference service ships with stored candidates, so the demo needs no API key and always plays out the same way.

The demo uses `--sandbox host`, which runs checks and agent commands directly on your machine with no isolation. It exists because the default sandbox needs Docker or Podman. See "What is not verified" below.

**The same request, sent to a real model:**

```bash
npm run demo -- --worker claude --model claude-haiku-5-5 --effort medium
```

The worker signs in the way Claude Code does on your machine (`claude auth login`), or with `ANTHROPIC_API_KEY`. The stored candidates are left out of the copy, so the model cannot read the answer. On a host sandbox the model may run only the checks listed in `.deck/deck.json`.

**Any other TypeScript repository:**

```bash
node packages/server/bin/decker.mjs <path-to-repo>
```

The map, search, code peek and editing work straight away. Sending a change to an agent then uses the Claude worker and a container sandbox.

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
| Move a block, or regroup it | Drag it. Dropping it on another area redraws it there and leaves the code where it is |
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
fixtures/              the hand-written design fixture, the generated ones, and measurements of real repositories
scripts/               the demo, and tools to measure a repository and to check a map against its source
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
| `e2e/canvas.spec.ts` | Zoom levels, the 11 px text floor, drilling in, tests chips, search, keyboard, outline, themes, every editing gesture with stored reference images, regrouping by drag, and the performance budgets on maps of 42, 300 and 1,500 blocks |
| `e2e/compile-up.spec.ts` | The real map, source peek and open-in-editor, harness-run test status, identical snapshots, live updates, identity across renames, summaries |
| `e2e/change-loop.spec.ts` | The demo from request to acceptance, tests on the new arrow, unrequested edits, deleted tests, parallel changes with a rebase, revert, and a server stopped mid-run |
| `e2e/integration-tier.spec.ts` | The Supabase-backed store checked against a real project, with the key kept out of everything stored or shown. Skipped on a machine without `TestDB.env` |
| `e2e/live-agent.spec.ts` | The demo request sent to a real model, with hostile instructions planted in the repository. Runs only with `DECKER_LIVE=1`, because it spends model usage |

`node e2e/tour.mjs <dir>` saves screenshots of each stage of the demo. `node scripts/measure-repo.mjs <path>` measures a first map of any repository. `node scripts/sample-check.mjs <deck.json> <path>` prints a sample of a map beside the source lines it claims.

## What is not verified

These parts are written and have not run to completion:

- **The container sandbox.** The development machine has no Docker or Podman. Every change-loop test runs in `--sandbox host` mode, so the code that runs Prepare, Implement and Check in containers with the network off has never executed.
- **The Claude worker against a real model.** The one attempt stopped at sign-in, before any model call. The loop is otherwise tested with the stored-candidate worker.
- **Hostile instructions** (spec M4). The test is written and is part of the live-agent suite. No model has met it yet.

Not built: the network allow-list for containers, the second demo in which an agent asks for a dependency and for network access, and a worker for other command-line agents.

## Credits

The canvas is built on [React Flow](https://reactflow.dev) and laid out with [ELK](https://eclipse.dev/elk/). Extraction uses the TypeScript compiler through [ts-morph](https://ts-morph.com).
