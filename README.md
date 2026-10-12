# Double Decker

A programming system with two connected decks, like a double-decker bus.

- The **lower deck** is ordinary source code. AI agents do most of the work there.
- The **upper deck** is a code-free map generated from that code. It has two views:
  - **Simple**, which the app opens on: a few large parts, each in its own color, a few plain sentences on each, and a labelled line between any two that talk. A line leaves through a ring and arrives at a chevron, so it reads at a glance who asks whom, and for what. It takes no knowledge of code to read, or to ask for something.
  - **Advanced**, one step behind it: areas, blocks with a name and a few bullets, and arrows. You pan, zoom and drill into it, all the way down to the source a block represents.

Ask for something on the map, in a sentence on a part or by editing a block, and it becomes a task for an agent. The agent's result comes back as a visual diff on the same map, with evidence, for you to accept, revise or reject.

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

Open http://localhost:4173. The switch at the top right of the canvas goes between Simple and Advanced. Add `?fixture=mid` for a 300-block map or `?fixture=stress` for a 1,500-block one, and `&view=advanced` to open straight on the full map.

**The whole loop**, on the reference service:

```bash
npm run demo
```

That copies `examples/shop` into a scratch git repository under `.demo/`, maps it, and opens the browser. Accepting a change commits to that copy, never to this repository, and every run starts clean.

In the simple view:

1. On the **Catalog** part, click **Ask for something new**, type "Let customers search for products by name", and press Enter. The request appears on the part in amber.
2. Click the flag on the part ("1 request not sent"), press **Submit**, read the plan, and approve it.
3. When the flag says **Ready to review**, click it. The part that changed stands out. **Accept**, and the sentence you typed stays on the part.
4. Now drag from the edge of the **Orders** part to **Inventory** and type "reserve stock for every item before an order is confirmed". Submit it and answer the plan's two questions.
5. Candidate 1 builds the connection and breaks a requirement: a harness-run test shows it reserves only part of an order, Inventory says **Contradicted**, and Accept is disabled. Press **Revise**. Candidate 2 passes. **Accept**, and the line keeps the words you asked in.

The same reservation request can be made in the advanced view, as an API arrow from the Orders block to the Inventory block with a label and bullets.

The reference service ships with stored candidates, so the demo needs no API key and always plays out the same way. The stored candidates answer a request whose words include "search", "reserve" or "low stock", and two more that the tests use. Anything else needs a real model, and says so.

The demo uses `--sandbox host`, which runs checks and agent commands directly on your machine with no isolation. It exists because the default sandbox needs Docker or Podman. See "What is not verified" below.

**The same requests, sent to a real model:**

```bash
npm run demo -- --worker claude --model claude-haiku-5-5 --effort medium
```

The worker signs in the way Claude Code does on your machine (`claude auth login`), or with `ANTHROPIC_API_KEY`. The stored candidates are left out of the copy, so the model cannot read the answer. On a host sandbox the model may run only the checks listed in `.deck/deck.json`.

**Any other TypeScript repository:**

```bash
node packages/server/bin/decker.mjs <path-to-repo>
```

The map, search, code peek and editing work straight away. Sending a change to an agent then uses the Claude worker and a container sandbox.

**Where the simple view's words come from.** With nothing configured, from the code: the doc comment of the block that leads an area, the doc comments of the operations other areas call, and labels made from the names of what is called. They are as plain as the code's comments. A `summarizer` in `.deck/deck.json` (any Anthropic or OpenAI-compatible endpoint, including a local one) has a model write them in everyday words. Either can be replaced by hand in a part's panel. The panel says which of the three each line is.

## Around the map

| | |
|---|---|
| Simple or advanced view | `S`, or the switch at the top right of the canvas |
| Pan | Drag the canvas, or Shift + arrows |
| Zoom at the cursor | Mouse wheel or pinch, `+` / `-` |
| Fit everything | `0` |
| Search and fly | `Ctrl+K` |
| Up one level | `Esc` |
| Undo, redo | `Ctrl+Z`, `Ctrl+Shift+Z` |
| All shortcuts | `?` |

In the simple view:

| | |
|---|---|
| Ask for something | "Ask for something new" on a part, or `N` with a part selected |
| Read a line | It leaves the part that asks through a ring in that part's color, and arrives at a chevron on the part that is asked. Dashed and amber: asked for, not built. `?` shows the legend |
| Ask for a connection | Drag from the ring with a plus on a part's edge to another part |
| Open a part in the advanced view | Double-click it, its "Open" button, or `Enter` |
| Say it better | Select a part or a line, and use the pencil in the panel |

In the advanced view:

| | |
|---|---|
| Expand a block | `Enter`, or its chevron |
| A block's tests | `T`, or the chip in its title row. `Shift+T` opens them all |
| Outline view | `Ctrl+\` |
| Open in editor | `Ctrl+Enter` |
| Move a block, or regroup it | Drag it. Dropping it on another area redraws it there and leaves the code where it is |
| New block, rename, remove | `N`, `F2`, `Delete` |

## What is in here

```text
packages/
  deck-model/          the deck's types, schemas, the deck text outline, and the simple view derived from them
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
| `e2e/simple.spec.ts` | The simple view: parts and labelled connections, the marks at a line's two ends, each part's own color, text contrast in both themes, the 11 px text floor at every zoom, the switch and each view's own place, opening a part, asking on a part and between two, the panel and rewriting by hand, hover and keyboard, frame rate, and a 300-block map |
| `e2e/simple-loop.spec.ts` | The simple view on real code: words derived from the code, a request typed on a part from plan to acceptance, a connection asked for with a flawed candidate caught and a revision accepted, and a summarizer writing the words |
| `e2e/canvas.spec.ts` | The advanced view: zoom levels, the 11 px text floor, drilling in, tests chips, search, keyboard, outline, themes, every editing gesture with stored reference images, regrouping by drag, and the performance budgets on maps of 42, 300 and 1,500 blocks |
| `e2e/compile-up.spec.ts` | The real map, source peek and open-in-editor, harness-run test status, identical snapshots, live updates, identity across renames, summaries |
| `e2e/change-loop.spec.ts` | The demo from request to acceptance, tests on the new arrow, unrequested edits, deleted tests, parallel changes with a rebase, revert, and a server stopped mid-run |
| `e2e/integration-tier.spec.ts` | The Supabase-backed store checked against a real project, with the key kept out of everything stored or shown. Skipped on a machine without `TestDB.env` |
| `e2e/live-agent.spec.ts` | The demo request sent to a real model, with hostile instructions planted in the repository. Runs only with `DECKER_LIVE=1`, because it spends model usage |

`node e2e/tour.mjs <dir>` saves screenshots of each stage of the demo. `node scripts/measure-repo.mjs <path>` measures a first map of any repository. `node scripts/sample-check.mjs <deck.json> <path>` prints a sample of a map beside the source lines it claims.

## What is not verified

These parts are written and have not run to completion:

- **The container sandbox.** The development machine has no Docker or Podman. Every change-loop test runs in `--sandbox host` mode, so the code that runs Prepare, Implement and Check in containers with the network off has never executed.
- **The Claude worker against a real model.** The one attempt stopped at sign-in, before any model call. The loop is otherwise tested with the stored-candidate worker. That includes requests made in the simple view: no model has yet been handed a sentence asked of a whole area.
- **A real model writing the simple view's words.** The summarizer path is tested against a stand-in endpoint. How plainly a real model words an area has not been seen.
- **Hostile instructions** (spec M4). The test is written and is part of the live-agent suite. No model has met it yet.

Not built: the network allow-list for containers, the second demo in which an agent asks for a dependency and for network access, and a worker for other command-line agents.

## Credits

The canvas is built on [React Flow](https://reactflow.dev) and laid out with [ELK](https://eclipse.dev/elk/). Extraction uses the TypeScript compiler through [ts-morph](https://ts-morph.com).
