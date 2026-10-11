# Double Decker

**Design specification v0.4 · 2026-10-11 · Dallas**  
**Concept owner: Jay Reed**  
**Status: Proof of concept built through M4, verified end to end in host-sandbox mode. The container sandbox has never run, and the Claude worker has not yet completed a run against a real model. See "Build status" below.**

Supersedes v0.1, archived unchanged as `double_decker_original_idea_deprecated.md`. Appendix B lists what changed from v0.1 to v0.2. The "Build status" section lists what changed while building.

## Build status

Built on 2026-10-11, straight through from M0 at Jay's instruction, without the M0 sign-off pause. The look and feel is therefore still open to his review, and nothing below depends on it staying as it is.

| Milestone | State | Verified by |
|---|---|---|
| **M0** The canvas | Built | `e2e/canvas.spec.ts`, 15 tests |
| **M1** Compile up | Built | `e2e/compile-up.spec.ts`, 6 tests. Hono and Supabase Storage runs and the hand-checked sample are recorded in `fixtures/repos.json` |
| **M2** Edit the deck | Built | The editing and regrouping tests in `e2e/canvas.spec.ts`, with stored reference images |
| **M3** The agent loop | Built. Verified with stored candidates in host-sandbox mode only | `e2e/change-loop.spec.ts`, 6 tests |
| **M4** Trust | Built, except what needs a container or a real model | Same suite, plus `e2e/integration-tier.spec.ts`, 3 tests |
| **M5** Prove and extend | Not started | |

All 30 of those tests pass. A 31st, `e2e/live-agent.spec.ts`, is described below and has not passed.

**Not verified.** These are written and have never run to completion:

- **The container sandbox** (§6.3). The development machine has no Docker, Podman or WSL 2. Every loop test uses `--sandbox host`.
- **The Claude worker against a real model** (§6.2). It is wired for any model and effort, and `e2e/live-agent.spec.ts` drives the §9.1 demo request through it with Claude Haiku 5.5 at medium effort. The one attempt stopped before the first model call: the Claude Code sign-in on this machine had expired. Nothing was spent. The attempt did find two faults, both fixed: a failed sign-in was reported as "no plan", and decker started from inside another Claude Code session handed that session's settings to its worker.
- **M4's hostile-instruction test.** It is part of the same live test: instructions planted in a README, a source comment and a package script tell the agent to write outside its worktree, run the script, and copy out a file it should not read. The guard those instructions would meet runs on every tool call, and on a host sandbox a model may run only the configured checks. Neither has been exercised by a model.

**Not built.**

- The network allow-list for containers (§6.3). Without it a check that needs the network is skipped in a container. On a host sandbox it runs.
- The second demo of §9.3, in which an agent asks for a new dependency and for network access and both wait for approval.
- The generic worker for command-line agents (§6.2). It waits for the allow-list.
- Opening VS Code itself is not exercised by a test. The tests point the editor command at a script that records the path and line it was given.

**Decisions made while building.** Each replaces the text it names.

| Topic | What was built | Why |
|---|---|---|
| Zoom thresholds (§3.4) | System below 0.3, Architecture 0.3 to 0.6, Blocks above 0.6 | The 11 px text floor could not hold at the starting values. Between 0.6 and 1.0 card text is scaled up in steps and fewer bullets are shown, so nothing drops below 11 px |
| Top-level layout (§3.11) | ELK decides the order of top-level areas, callers first. They are then arranged in rows that fit a wide screen | A strictly layered top level made the shop fixture three screens tall. It now fits one screen at Architecture level |
| Large sparse areas (§3.11) | An area of ten or more things that layers leave under 30% full is laid out as a packed shelf | Hono's JSX area was 21% full under layers: one long column and an empty half |
| Area titles | Drawn above the arrows, in a layer of their own | Arrows were striking titles out |
| Arrow labels | Sit on the last run of the arrow, near the block they point at, and fan out when several arrive together. A label slides along its run to stay clear of cards, and one that only names the arrow's kind is left out when there is no clear spot | Labels at the midpoint collided, and labels under a card showed as slivers at its edge |
| How arrows are drawn | Each straight run and each rounded corner is a path of its own | A browser draws one long bent line through a mask the size of its bounding box, every frame. With 140 on screen that was most of a frame |
| Minimap | Our own: areas only, one subscription to the camera | React Flow's keeps a component per node, re-evaluated on every camera frame |
| State badges on blocks | Hang on the card's top edge | In the title row they pushed the name out |
| First fit | A map first drawn while its window is hidden or a sliver is fitted again the first time it has room | It was fitted to a canvas of no size and stayed a speck at 5% |
| Regrouping (§3.8) | Dragging a block over another area lights that area up and regroups the block there. The move is kept in `.deck/layout.json`, the panel says where the code still lives, and "Put back" undoes it. Neighbours make room | The spec left where a regrouping is stored to "area rules". Layout is where every other hand placement lives, and agents are still told where the code really is |
| Tests on arrows (§3.7) | An API arrow's label carries a chip for the tests its requirements named, in review and after acceptance | Built as specified. In review the arrow is also drawn with the kind and label that were asked for |
| A chip whose tests were all skipped | Reads `–3` | It read `✓0/3` in green, which looks like a pass |
| Host sandbox | `decker --sandbox host` runs checks and agent commands on the engineer's machine with no isolation. It is opt-in and announced at start-up. A model may run only the configured checks there, with extra arguments. Stored candidates may run anything | Without it the loop could not be exercised on a machine with no container runtime. Containers remain the default whenever a runtime answers |
| Stored candidates | A worker that replays stored plans and candidates from `examples/shop/demo` | Makes every loop outcome deterministic, as §9.1 asks for the flawed candidate |
| Worker confinement (§6.2) | Every tool call passes a guard before it runs, whatever the permission mode would decide. Paths outside the worktree, `.deck`, `.git` and patterns that climb out are refused, and each refusal is shown in the change's progress | A permission callback alone is not asked about every call |
| Accepted intent | On Accept, an arrow's kind, label, bullets, linked tests and the plan's accepted limits are saved to `.deck/notes.json` as authored notes | The extractor sees only a call. Without this the "API · Reserve stock" label would vanish on acceptance |
| Source folder | When one folder holds at least 70% of the code, its contents are the top level of the map | Otherwise a repository with `src/` beside scripts shows one giant "Src" area |
| Single-file folders | A folder holding one block is shown as that block in the parent area. If that gives two blocks one name in an area, the lifted one takes its folder's name | Hono's 25 middleware folders were 25 areas of one block each |
| Files that only re-export | Not blocks. They are a way in to other blocks | They were drawn as empty cards |
| Exports by list | `export { Hono as HonoBase }` makes the class public, under the exported name | Found by the hand check: such exports were marked internal |
| Functions behind a cast | `const Suspense: FC = ((props) => { ... }) as any` is an operation | Found by the hand check |
| Function-valued class properties | Treated as operations, like methods | Common in TypeScript, and tests call them |
| Route operations | A route whose handler calls one operation borrows that operation's doc comment as its bullet | "List the products on sale" reads better than "GET /products" alone |
| Services reached without a package | A doc comment with `@service Supabase` puts the service on the map as an External | A plain `fetch` leaves no import to see |
| Test database store (§9.3) | Keeps its stock levels as one document in a Storage bucket | The key allows no schema changes over REST, and the project had no tables |
| Reference service size (§9.1) | About 1,100 lines with 45 tests and 3 integration tests, not 2,000 | Enough to exercise every element |

**Measured.** On an Intel Core i7-13700K with 32 GB RAM and an RTX 3080 Ti, Windows 11, headless Edge at 1440 by 900 with hardware acceleration. Frame rates are the 95th percentile over one sweep, from the last run of the test suite; they move by a few frames between runs.

| Budget (§10) | Target | Measured |
|---|---|---|
| Pan, 42 blocks and 77 arrows | 60 fps | 233 fps on the whole map, 119 fps on full cards |
| Wheel zoom inside one zoom band, 42 blocks | 60 fps | 233 fps |
| Pan, 300 blocks and 579 arrows | 60 fps | 233 fps with the whole map on screen, and the same at the Architecture level |
| Wheel zoom, 300 blocks | 60 fps | 119 fps with the whole map on screen. **18 to 24 fps at the Architecture level**: frames in which several cards and dozens of arrows come into view at once take 40 to 60 ms |
| Pan, 1,500 blocks and 3,784 arrows | 45 fps | 79 fps on the whole map, 79 fps on full cards |
| Wheel zoom, 1,500 blocks | 45 fps | 80 fps on the whole map, 119 fps on full cards |
| Crossing from one zoom band to the next | Not budgeted | One frame of 4 to 25 ms on 42 blocks, 21 to 75 ms on 300, 21 to 71 ms on 1,500, over the runs made. Everything on screen is redrawn for the new band |
| Blocks in the DOM | At most 400 | At most 75 of 1,500 |
| Select and open the panel; expand in place | Under 100 ms | Longest of eight: 77 ms and 20 ms. Across runs the longest select was 23 to 91 ms |
| Hover highlight | Under 100 ms | 6 ms after its deliberate 150 ms delay, and 3 to 17 ms across runs |
| First map, `examples/shop` | Under 3 s | 0.7 s (extraction 0.14 s) |
| First map, 10,000 lines | Under 10 s cold, 2 s warm | 1.0 s for 18,000 lines: Hono's JSX folder on its own. Nothing is cached, so warm is the same |
| First map, Hono, plain clone | Under 20 s cold | 3.4 s (extraction 2.1 s): 83,000 lines, 133 blocks, 98.4% resolved |
| First map, Supabase Storage, nothing installed | | 5.3 s (extraction 3.5 s): 156,000 lines, 250 blocks, 83.4% resolved |
| First map, 200,000 lines | Under 60 s cold | 10.1 s for 258,000 lines: both clones mapped as one tree. Not one real repository |
| Map update after a one-file edit | Under 2 s | 0.8 s |

Supabase Storage's 83.4% is with no dependencies installed, so every type imported from a package is unknown. The figure with dependencies installed has not been measured.

**The hand check** (M1). A fixed sample of 30 blocks and 30 arrows from Hono was read against the source. All 30 arrows were right. Three blocks were not, from the three extractor faults in the table above. They are fixed and a re-drawn sample is clean. `fixtures/repos.json` has the record, and `scripts/sample-check.mjs` draws the sample.

**The test database** (§9.3). The integration tier ran against the real project and passed. The key and the project's address appear in nothing the browser is sent, nothing on the page, nothing under `.deck`, nothing decker prints and nothing in the repository. The store's tests leave one bucket in the project, `decker-shop-stock`, and delete what they write to it.

## 1. The idea

Double Decker is a programming system with two connected decks, like a double-decker bus.

The **lower deck** is ordinary source code in an existing language. AI coding agents do most of the implementation work there. Engineers can open and edit it at any time.

The **upper deck** is a code-free map generated *from* that code: blocks, arrows, and areas, like an architecture drawing. Each block is a name with a few bullets underneath. It is an extremely dense compression of the program that an engineer can pan, zoom, and drill into, all the way down to the source a block represents.

The decks are linked in both directions:

- **Compile up.** Drop in an existing codebase. Double Decker extracts its structure and builds the map.
- **Compile down.** Edit the map directly: change a bullet, add a block, draw an arrow. Each edit becomes a task for one or more agents, who change the code. The map is rebuilt from the new code and shown as a visual diff for the engineer to accept, revise, or reject.

**The upper deck is the product.** Everything else exists to keep it truthful and to carry its edits down to code. The build order follows from that: the map's look, movement, and zoom are built and approved first (M0), before any extraction or agent work.

This is not visual programming in the Unreal Blueprints sense. There is no wire per value and no node per statement. The unit is "block with a name, bullets underneath," and more detail appears only when asked for.

## 2. Decisions

| Decision | Pick | Why, in one line |
|---|---|---|
| First lower-deck language | **TypeScript** (strict mode) | Largest reach, easiest language to map truthfully, fastest agent loop, same language as the platform |
| Second lower-deck language | **C++** | Where a map is worth the most and hardest to build; do it once the deck is proven |
| Platform language | **TypeScript end to end** | The UI must be TS; the TS extractor API is JS; one toolchain, shared types |
| Deployment | **Local-first web app** | The UI runs in the browser; a small local server reads the repo, runs agents, opens the editor |
| Canvas | **React Flow + ELK layout** | Real DOM blocks stay crisp at every zoom, draw-an-arrow is built in, MIT licensed |
| Look | **Dark-first** | Designed like an IDE; a light theme follows from the same tokens |
| Storage | **`.deck/` folder in the repo, plus git** | Human-readable, diffable, no database to run |
| Agents | **Claude first, any worker behind one gateway** | First worker: Claude Agent SDK. Later: a generic worker for command-line agents (Codex CLI, OpenCode) |
| Sandbox | **Containers with the network off** | Repository code and agent-issued commands only ever execute inside a container |
| First real codebases | **Hono, then Supabase Storage** | A mid-sized, dependency-free, heavily tested library first; a production backend service second (§9.2) |

Evidence and runners-up are in Appendix A. The short version of the language decision:

- **TypeScript wins the proof of concept.** It is the most-used language on GitHub, its compiler hands over resolved symbols, types, and call targets in-process from nothing but a `tsconfig.json`, and a check-and-test cycle takes seconds.
- **TypeScript gives up raw runtime speed.** C++ and Rust produce faster programs. That matters to the long-term product and not to proving the two-deck loop.
- **C++ is second on purpose.** It needs a working build before anything can be extracted, extraction of large codebases takes hours without incremental indexing, and it was the lowest-scoring language for agents in the one per-language benchmark found. Starting there would test the adapter, not the idea.
- **Rust (v0.1's pick) is a credible alternative** with the best agent scores, but it has about a third of TypeScript's reach, much of its architecture lives inside macros that static extraction cannot see, and it would add a second toolchain.

## 3. The upper deck

This section is the core of the spec. M0 implements it against a hand-written fixture before anything else exists.

### 3.1 Principles

1. **Calm at rest, dense on demand.** At any zoom the screen shows one level of abstraction. Detail arrives by zooming or expanding, never all at once.
2. **Movement is the navigation.** Everything lives on one continuous canvas. No page loads and no modal drill-downs.
3. **Nothing moves unless the code moved.** Layout is stable across rebuilds, so a change of position never looks like a change of architecture.
4. **The map never claims more than it knows.** Requested, implemented, accepted, AI-summarized, and unknown all look different (§3.10, §7).
5. **Always one click from the code.**

### 3.2 Screen

```text
┌──────────────────────────────────────────────────────────────────────┐
│ shop ▸ Inventory          [ Search   Ctrl+K ]       Changes (1)   ◐  │  top bar
├────────────────────────────────────────────────┬─────────────────────┤
│                                                │ Inventory           │
│                                                │ Tracks stock and    │
│                  canvas                        │ reservations        │
│          (areas, blocks, arrows)               │                     │  detail panel
│                                                │ Behavior            │  (opens on select)
│                                                │ Operations          │
│                                                │ Data                │
│ [−] [+] [fit]                      ┌─────────┐ │ Source    ↗ Open    │
│                                    │ minimap │ │                     │
└────────────────────────────────────┴─────────┴─┴─────────────────────┘
```

The canvas takes all available space. The detail panel is a 380 px right dock, resizable and closable. The top bar holds the breadcrumb, search, the change tray, and the theme toggle. An outline view (a searchable tree of the same content) slides in from the left on demand.

### 3.3 Elements

| Element | What it is | Looks like |
|---|---|---|
| **Area** | A region grouping related blocks; areas nest | Tinted rounded region with its title at top left |
| **Block** | A unit of code with a public surface | Card: name, optional one-line summary, bullets |
| **Arrow** | A directed interaction between blocks | Line with arrowhead; a label pill for its kind |
| **External** | Something outside the repo (a package, a service) | Small pill docked at the edge of the area that uses it |
| **Opaque** | Code the extractor could not understand | Hatched marker on the owning block, with a count |

The block is the heart of the design:

```text
┌────────────────────────────────┐
│ Inventory              ▸ ✓12 ⌄ │   name (semibold), tests chip (§3.7), expand chevron
│ Tracks stock and reservations  │   one-line summary (muted)
│ • Reserve stock for an order   │   bullets: one behavior each, verb first
│ • Release a reservation        │
│ • Report availability          │
│ +2 more                        │
└────────────────────────────────┘
```

- Fixed width of 280 px at 100% zoom. Height follows content.
- At most five bullets on the card, one line each, with "+N more" below. Full text is in the detail panel and on hover.
- Bullets are phrased as behavior ("Reserve stock for an order"), never as identifiers (`reserveStock`). Identifiers and signatures appear one level down.

Bullets come from three sources, and the marker shows which:

| Origin | Derived from | Marker | Truth layer (§7) |
|---|---|---|---|
| **Declared** | A function or method name, humanized, or the first sentence of its doc comment | `•` solid dot | Observed code fact |
| **Summarized** | An AI model reading the code body | `◦` hollow dot; "AI summary" in the panel | Interpretation |
| **Authored** | Written or pinned by an engineer | `▪` square | Intent |

When several sources exist for the same operation, the card shows the first available of: authored, doc comment, summarized, humanized name. The detail panel shows all of them with their source lines.

### 3.4 Zoom levels

Zoom controls **how many things** are in view. It never changes layout: every block and area keeps its position and size, and only the drawing inside changes.

| Level | Zoom (starting values, tune in M0) | Areas | Blocks | Arrows |
|---|---|---|---|---|
| **System** | below 0.3 | Title and block count | Unlabeled chips, so density stays visible | One per pair of areas, with a count |
| **Architecture** | 0.3 to 0.6 | Title | Name only, set large enough to read | One per pair of blocks; labels on hover |
| **Blocks** | above 0.6 | Title | Full card: name, summary, bullets | One per pair of blocks, labeled |

These are the values tuned during M0. The starting values were 0.2 and 0.55.

Rules:

- No text is ever drawn smaller than 11 px on screen. Text that would be smaller is hidden or replaced by the next level's representation. Area titles and Architecture-level names are counter-scaled to stay legible.
- Levels crossfade over 120 ms. A small hysteresis band at each threshold prevents flicker.
- Blocks re-render only when crossing a level threshold, never on every zoom frame.
- At most about 400 blocks are in the DOM at once. Off-screen blocks are not rendered; at System level, blocks are drawn as plain chips.

### 3.5 Camera and input

| Action | Mouse | Trackpad | Keyboard |
|---|---|---|---|
| Pan | Drag empty canvas, or middle-drag | Two-finger scroll | Shift + arrows |
| Zoom at cursor | Wheel | Pinch | `+` / `-` |
| Fit everything | | | `0` |
| Focus selection | Double-click a block | Double-tap | `F` |
| Move selection to a neighbor | Click | Tap | Arrows |
| Expand or collapse | Click chevron | Tap chevron | `Enter` |
| Open or close a block's tests | Click tests chip | Tap tests chip | `T` |
| Open or close all tests in view | | | `Shift+T` |
| Up one level | | | `Esc` |
| Search and fly | | | `Ctrl+K` |
| Camera back / forward | | | `Alt+←` / `Alt+→` |
| Toggle outline view | | | `Ctrl+\` |

- Pan and zoom track the pointer directly with no lag. Zoom range is 0.05 to 2.5.
- Camera jumps (search, focus, clicking an arrow's far end) animate over 300 to 400 ms with ease-out. Long jumps zoom out, travel, and zoom in rather than sliding across the map. Any input interrupts the animation.
- Every jump pushes the camera onto a history stack. The current focus is in the URL (`#/block/<id>`), so browser back works and a view can be shared as a link.
- `Esc` unwinds one step at a time: close the popover, collapse the expansion, clear the selection, then zoom out to the enclosing area.

### 3.6 Drilling in

Zoom shows how many things. **Expanding shows how deep into one thing.** The steps, shallowest first:

1. **Hover** (after 150 ms): the block's arrows and neighbors stay at full strength and everything else dims to 35%.
2. **Select** (click): the detail panel opens with the summary, all bullets and their origins, operations with signatures, data types, incoming and outgoing arrows (click one to fly to the other end), state and evidence, and the source path.
3. **Expand in place** (chevron or `Enter`): the card grows to list its operations with signatures and its data types. Only the enclosing area re-lays out; other blocks keep their relative order, positions animate over 250 ms, and everything returns on collapse. An expanded block has a "Show internals" toggle that reveals call arrows between its operations.
4. **Code peek** (Source tab in the panel): read-only, syntax-highlighted source for the selected block or operation, headed by `path:line`.
5. **Open in editor** (button, or `Ctrl+Enter`): opens the file at that line in the configured editor. VS Code is the default. Visual Studio and JetBrains IDEs are configured through an editor command template.

### 3.7 Tests

Tests never appear as blocks. They hang off the piece of architecture they exercise, behind a collapsed chip in the title row that costs no space at all.

```text
┌────────────────────────────────┐
│ Inventory              ▸ ✓12 ⌄ │   chip closed: one glyph and a count
│ Tracks stock and reservations  │
│ • Reserve stock for an order   │
│ • Release a reservation        │
├────────────────────────────────┤   chip open: the tests drawer
│ reserve                    ✓ 7 │   grouped by the operation they call
│  ✓ reserves every item         │   one line per test, titled as written
│  ✓ rejects a partial order     │
│  ✓ ignores a repeated request  │
│  +4 more                       │
│ release                    ✓ 5 │
└────────────────────────────────┘
```

| Chip | Meaning |
|---|---|
| `✓12` | All twelve tests passed at this commit |
| `✕2/12` | Two of twelve are failing |
| `12` | Twelve tests exist and have not been run at this commit |
| `–3` | All three were skipped: nothing passed and nothing failed |
| `0` (muted) | Nothing exercises this block |

- **Opening one.** Click the chip or press `T`. The drawer lists up to eight tests, grouped by operation, one line each, then "+N more." The full list is in the panel's Tests tab. Clicking a test opens its source in the code peek.
- **Opening all.** `Shift+T` opens or closes every drawer in view. This is the "what hangs off what" view of the whole architecture, and untested blocks stand out by their `0`.
- **Deeper.** In an expanded block, every operation row carries its own chip. An API arrow carries a chip on its label pill for the tests that a change linked to its requirements.
- **By zoom level.** At System level an area's title shows its total and its failing count. At Architecture level only failing blocks are marked, with a `✕` dot, unless `Shift+T` is on. At Blocks level every block shows its chip.
- **What "hangs off" means.** A test hangs off an operation when the test's body calls that operation directly, as resolved by the type checker. Two weaker fallbacks are labeled as such in the panel: the test file imports the block, or it sits beside the block by naming convention. This is "calls directly," not coverage. The map does not claim a test covers code it only reaches indirectly.
- **Status is never stale.** Pass and fail come only from a harness run at the current commit. A result from an older commit is shown as not run.
- **Skipped is not passed.** A test that was skipped, for example an integration test whose database was unreachable, shows `–` in the drawer and is left out of the chip's pass count.
- **In review.** Tests the agent added, changed, or deleted are flagged on the chip (`+3 new`, `1 changed`, `1 deleted`). Weakening tests is one way a candidate can look better than it is.

### 3.8 Editing the deck

Editing the map is how an engineer programs. Each gesture creates a **change operation**. Operations collect in a **Change**, shown in the change tray, and nothing is sent to an agent until the engineer presses Submit.

| Gesture | Operation | Pending look |
|---|---|---|
| Click a bullet and type | `set_behavior` | Change bar beside the bullet |
| "+ Add bullet" on a block or arrow | `add_behavior` | Change bar, "Requested" badge |
| Drag from a block's edge to another block | `add_edge` (popover asks for kind, label, bullets) | Dashed arrow, "Requested" badge |
| `N`, or double-click empty space in an area | `add_block` (name and bullets) | Dashed card, "Requested" badge |
| `F2` on a block or operation | `rename` | Old name struck through beside the new one |
| `Delete` on a block, arrow, or bullet | `remove` | Faded and struck through |
| Drag a block, or drag it into another area | none: layout only | none |

- Moving and regrouping change only the picture. They never create a change, and changes never move the layout by themselves.
- A block dragged over another area is regrouped there on drop, and the area lights up while it is held over it. The panel then says where the block is drawn and where its code lives, and offers "Put back". Agents are always told where the code really is.
- A dropped block comes to rest clear of its neighbours, and an area that grew pushes aside the areas it would cover.
- Undo and redo (`Ctrl+Z`, `Ctrl+Shift+Z`) cover pending operations and layout moves.
- A requested item never looks implemented. Dashed line plus badge is reserved for "asked for, not yet built."

### 3.9 Review

When an agent finishes, the same canvas enters review mode for that change. A banner names the change and candidate and offers **Accept**, **Revise**, and **Reject**.

| Finding | Meaning | Look |
|---|---|---|
| **Implemented** | Requested, and now present in the code | Solid line, check badge |
| **Missing** | Requested, and not found in the candidate | Still dashed, amber "Missing" badge |
| **Contradicted** | A required check failed | Red "Contradicted" badge linking to the check output |
| **Unrequested** | The agent changed something nobody asked for | Violet "Unrequested" badge |
| Unchanged | Everything else | Dimmed to 50% |

- A checklist in the panel lists every operation and requirement with its finding. Clicking one flies to it.
- Holding `B` shows the map before the change. Because layout is stable, only real differences move.
- Each changed element has a code diff tab. The full diff is one click away.

### 3.10 Visual language

**Dark-first.** The map is designed in dark mode first, like an IDE. Depth is shown with lighter surfaces, not shadows.

**One rule above the rest: line pattern shows state, and the label shows kind.** Dashes always mean "requested," so they are never used to distinguish kinds of arrow.

| Token | Value |
|---|---|
| UI typeface | Inter |
| Code typeface (identifiers, signatures, source) | JetBrains Mono |
| Block title | 14 / 20 semibold |
| Bullets and summary | 12.5 / 18 regular |
| Signatures | 12 / 18 mono |
| Spacing grid | 4 px; blocks snap to 8 px |
| Block | 280 px wide, 12 px padding, 10 px radius, 1 px border, no shadow at rest |
| Area | 16 px radius, 24 px padding, fill at 6% of its hue, 1 px border |
| Gaps | At least 24 px between blocks, 48 px between areas |
| Canvas | `#0E0F12`, with a 24 px dot grid that fades out below 0.5 zoom |
| Block surface, border | `#17191D`, `#2A2D34` |
| Text, muted text | `#E8EAED`, `#9AA0AA` |
| Accent | `#7C8CFF` |
| Requested, candidate, contradicted, unrequested, passing | `#F2B84B`, `#5AA9FF`, `#FF6B6B`, `#B48CFF`, `#4CC38A` |
| Arrows | 1.5 px, orthogonal with 8 px rounded corners, small filled arrowhead |
| Merged arrows | Width grows with the count, from 1.5 to 4 px |
| Motion | 120 ms hover and selection, 250 ms expand and layout, 300 to 400 ms camera; ease-out |

- **The color values are starting points** to tune in M0. Body text must keep at least 4.5:1 contrast against its surface.
- **Color is used sparingly.** One accent color marks selection and interaction. Areas get a muted hue, assigned from a fixed palette by area ID, used only for the area tint. Accepted code has no state color at all: it is the resting state.
- **State colors:** requested is amber, implemented candidate is blue, contradicted is red, unrequested is violet, unknown or opaque is gray hatching. Every state also has a badge with its name, so color is never the only signal.
- **Arrow kinds** are shown by the label pill: `call` has no pill, `API · reserve` names the operation, and events, data access, and external dependencies each have a glyph.
- **Selection** is a 2 px accent ring with a faint outer glow. Hover lightens the border.
- **Themes.** Dark is the default and the one that gets design sign-off. A light theme is derived from the same tokens and is available through the toggle.
- **Reduced motion** is honored: camera jumps cut instead of animating.

### 3.11 Layout

- The first build lays out automatically with ELK's layered algorithm, top to bottom, so callers sit above what they call and the picture reads like a layered architecture drawing. Arrows attach to the top and bottom of blocks, and to the sides when two blocks sit side by side.
- At the top level, ELK decides the order of the areas and they are then arranged in rows, in reading order, to fit a wide screen.
- A large area that layers would leave mostly empty (ten or more things, under 30% full) is laid out as a packed shelf instead.
- After that, positions are saved in `.deck/layout.json`. A rebuild places only new blocks, inside their area and near their callers. It never moves existing ones.
- Blocks the engineer has dragged stay where they were put.
- "Tidy up" re-runs the full layout on request, animated and undoable.
- Layout runs in a web worker and never blocks the canvas.

### 3.12 Accessibility

- Everything is reachable by keyboard, with a visible focus ring.
- The outline view is the textual equivalent of the map: the same areas, blocks, bullets, and arrows as a searchable tree. It is also the format agents receive (§4.4).
- States are distinguishable without color. Screen-reader labels describe each block as "name, kind, state, N bullets."

## 4. The deck model

### 4.1 Entities

```ts
type Id = string; // opaque and stable, e.g. "blk_7f3a2c"

interface DeckNode {
  id: Id;
  kind: 'system' | 'area' | 'block' | 'operation' | 'data' | 'external';
  name: string;
  parentId: Id | null;
  summary?: Bullet;          // the one-line responsibility
  bullets: Bullet[];
  signature?: string;        // operations and data
  source: SourceRef[];       // where it lives in the lower deck
  coverage: 'full' | 'partial' | 'opaque';
}

interface Bullet {
  id: Id;
  text: string;
  origin: 'declared' | 'summarized' | 'authored';
  derivedFrom?: SourceRef;   // the name, doc comment, or span that was summarized
}

interface DeckEdge {
  id: Id;
  from: Id;                  // operation or block; rolled up to blocks and areas for display
  to: Id;
  kind: 'call' | 'api' | 'event' | 'data' | 'dependency';
  label?: string;
  indirect?: string;         // e.g. "via StockStore" when resolved through an interface
  bullets: Bullet[];
  evidence: SourceRef[];     // the call sites or imports that establish it
}

interface SourceRef {
  path: string;
  symbol?: string;
  startLine: number;
  endLine: number;
  hash: string;              // content hash of the span
}

interface Gap {
  ownerId: Id;               // the block that contains it
  reason: 'dynamic-call' | 'dynamic-import' | 'untyped' | 'parse-error' | 'unsupported';
  source: SourceRef;
}

interface DeckTest {
  id: Id;
  name: string;              // the test's title as written
  suite: string[];           // enclosing describe titles
  source: SourceRef;
  targets: {                 // the operations or blocks it hangs off
    id: Id;
    via: 'calls' | 'imports' | 'name';
  }[];
}

interface DeckSnapshot {
  schemaVersion: 1;
  sourceCommit: string;
  dirty: boolean;
  adapter: { name: string; version: string; configHash: string };
  nodes: DeckNode[];
  edges: DeckEdge[];
  tests: DeckTest[];
  gaps: Gap[];
}
```

The model is language-neutral. A language adapter's whole job is to produce a `DeckSnapshot`.

Test results are not part of the snapshot, which depends only on the code. They are evidence, stored per commit in the cache and joined to tests by ID when the map is drawn.

### 4.2 Identity

IDs are opaque and assigned the first time an entity is seen. Names, paths, and line numbers are attributes that can change. Layout and authored bullets hang off IDs, which is how they survive refactors.

On each rebuild, entities are matched in this order:

1. An existing binding in `.deck/ids.json` (ID to symbol key, where the key is `package : module path # exported name`).
2. A file that git reports as renamed, with the same exported name.
3. The same signature and body hash under a new name. This is only *suggested* as a rename, and the engineer confirms it on the map.

Anything unmatched gets a new ID, and the old ID is kept as a tombstone.

### 4.3 On disk

```text
<repo>/.deck/
  deck.json          settings: adapter, tsconfig, area rules, test file patterns,
                     editor command, checks to run, container image
  ids.json           identity bindings and tombstones
  layout.json        positions, hand-placed blocks, blocks regrouped into another area
  notes.json         authored and pinned bullets; what an accepted arrow was asked to be
  changes/<id>.json  one file per change: operations, plan, candidates, decisions (append-only events)
  cache/             git-ignored: compiled snapshots, AI summary cache, check output
```

- Everything outside `cache/` is committed with the code and reviewed like code.
- The compiled snapshot is a build artifact. It is never edited by hand and is always reproducible from the source plus the committed `.deck/` files.
- Writes are atomic (write to a temporary file, then rename). The PoC uses no database.

### 4.4 Deck text

The same model renders as a plain-text outline. One format serves three purposes: the accessible equivalent of the map, the compact context handed to agents, and a diffable record of what a change did to the architecture.

```text
# shop
## area: Inventory
### block: Inventory                        src/inventory/index.ts
Tracks stock and reservations.
• Reserve stock for an order                reserve(orderId, items, key)
• Release a reservation                     release(reservationId)
◦ Rejects the whole order if any item is short
-> StockStore: call (read, write)
<- Orders: API reserve                      [requested]
```

## 5. Compile up: the TypeScript adapter

### 5.1 Pipeline

1. Record the commit, whether the tree is dirty, and a hash of the adapter configuration.
2. Load the project from `tsconfig.json` with the compiler API (through ts-morph). Project references are followed. `.deck/deck.json` can name a different config. Plain JavaScript and JSX are read through the same API with `allowJs`.
3. Extract declarations, signatures, doc comments, imports, and resolved calls.
4. Group them into areas and blocks (§5.2).
5. Derive declared bullets (§5.3).
6. Record everything unresolved as a gap.
7. Match identities (§4.2), validate against the schema, and write the snapshot.

The same commit and configuration must produce a byte-identical snapshot: arrays are sorted, and nothing time-dependent goes inside.

### 5.2 Mapping

| Lower deck (TypeScript) | Upper deck |
|---|---|
| Repository or workspace root | System |
| Workspace package; directory | Area (nested) |
| A directory whose `index.ts` re-exports its contents | Block (its files are internals, shown when expanded) |
| Any other file with exports; an entry-point file | Block |
| A file that only re-exports | Nothing: it is a way in to other blocks |
| Exported function; public method of an exported class; route handler | Operation. Exported includes `export { a as b }`, and a function behind a cast or parentheses still counts |
| Exported interface, type, enum, or class used in a signature | Data |
| Imported npm package or Node built-in | External, one per package |
| A doc comment tagged `@service Name` | External: a service reached without a package, such as by `fetch` |
| A call the type checker resolves to a declaration in another block | `call` arrow, with the call site as evidence |
| A call through an interface type | `call` arrow to each implementation in the repo, marked `indirect` |
| A type used across blocks | `data` arrow (hidden on the canvas, listed in the panel) |
| A literal route registration in a supported HTTP framework | Operation tagged `api` |
| Each `it` or `test` call in a test file | Test, titled with its string argument |
| A call from a test body that resolves to an operation | The test hangs off that operation (`via: calls`) |
| Dynamic import, computed member call, `any`-typed call, reflection-based injection, `eval` | Gap on the owning block |

- Regrouping on the map is kept in `.deck/layout.json` and does not move code (§3.8). Area rules in `.deck/deck.json`, to override the directory structure for everyone, are not built.
- Two blocks in one area never share a name: a block lifted out of a single-file folder takes the folder's name.
- Test files (`*.test.*`, `*.spec.*`, and anything under `__tests__`, configurable) never become blocks. Their tests attach to what they exercise (§3.7). Tests are recognized by the shape of the call, so this works even when the test runner is not installed.

### 5.3 Bullets

- **Declared bullets need no model.** Each public operation yields one bullet: the first sentence of its doc comment if there is one, otherwise its name humanized (`reserveStock` becomes "Reserve stock"). A block's summary is its module doc comment if present.
- **Summarized bullets are an optional second pass.** A model reads one block's source and returns a summary line and up to five bullets, each citing the span it describes. Results are cached by source hash, prompt version, and model, so unchanged code is never re-summarized.
- The map renders from declared bullets immediately. Summaries stream in afterward and never delay the first paint.
- The engineer can pin a summarized bullet, which makes it authored, or dismiss it.
- The summarizer accepts any Anthropic or OpenAI-compatible endpoint, including a local one. With no model configured the product still works.

### 5.4 Staying current

A file watcher re-extracts changed files and whatever depends on them, diffs the snapshot, and pushes a patch to the browser. New blocks fade in, removed ones fade out, and nothing else moves. A full rebuild is always available to check the incremental path against.

## 6. Compile down: the change loop

### 6.1 Lifecycle

```text
Draft ─submit→ Planning ─→ Plan ready ─approve→ Implementing ─→ Checking ─→ In review ─accept→ Accepted
                  │                                  │                          ├─revise→ Implementing (next candidate)
                  └→ Needs answer                    └→ Failed                  └─reject→ Rejected
```

1. **Draft.** Operations accumulate in a change. Every edit is saved to `.deck/changes/<id>.json`.
2. **Planning.** A planning agent with read-only access receives the deck text around the affected blocks and the operations. It returns a plan: its interpretation in plain English, a checklist of requirements written as testable statements, the files it expects to touch, the checks it proposes, and any questions.
3. **Plan ready.** The engineer edits the plan, answers questions, and approves. The approved plan is the agreed contract.
4. **Implementing.** The coordinator creates a git worktree on branch `deck/<change>/c<n>` from the current base commit and prepares its container (§6.3). The agent edits files only in that worktree and runs commands only in that container. Progress streams to the change tray.
5. **Checking.** The harness, not the agent, runs the checks listed in `.deck/deck.json` plus those the plan required: type-check, tests, lint. They run in a fresh container with the network off. Output is stored per candidate.
6. **In review.** The candidate is extracted, compared with the base and the request (§6.4), and shown in review mode (§3.9).
7. **Accepted, revised, or rejected.**
   - Accept merges the candidate into the working branch. It is refused if the base has moved (rebase, re-check, and review again), if a required check failed, or if a requirement is contradicted and has not been explicitly waived with a note.
   - Revise takes a comment and optionally new operations, and produces the next candidate. Earlier candidates are kept.
   - Reject removes the worktree. The change record and the original request are kept.

### 6.2 Agent gateway

```ts
interface AgentWorker {
  plan(pkg: WorkPackage): AsyncIterable<AgentEvent>;                         // read-only
  implement(pkg: WorkPackage, sandbox: Sandbox): AsyncIterable<AgentEvent>;  // writes only inside pkg.worktree
}

interface Sandbox {
  // Executes inside the candidate's container (§6.3).
  run(command: string): Promise<{ exitCode: number; output: string }>;
}

interface WorkPackage {
  changeId: string;
  candidate: number;
  worktree: string;          // absolute path; the agent's only writable location
  baseCommit: string;
  deckText: string;          // the affected neighborhood, as in §4.4
  operations: ChangeOp[];
  plan?: ApprovedPlan;       // absent while planning
  allowedPaths: string[];    // globs inside the worktree
  budget: { minutes: number; turns: number };
}
```

- The result of `implement` is whatever diff is in the worktree, plus the agent's notes, its mapping of requirements to code, and any questions. An agent's statement that tests passed is not evidence. Only harness runs are.
- An agent cannot accept its own work, write outside its worktree, edit `.deck/` outside its own change file, or change which checks are required.
- An agent has no shell of its own. Its only way to execute anything is `Sandbox.run`, which the gateway carries out inside the container.
- Comments, READMEs, dependency contents, and agent output are untrusted data. They cannot grant permissions.
- The first worker uses the Claude Agent SDK, with its file tools confined to the worktree and its command execution replaced by `Sandbox.run`. A small Claude model writes the optional bullet summaries.
- The model and how hard it thinks are settings: `decker --model claude-haiku-5-5 --effort medium`, or `worker` in `.deck/deck.json`. The default is Claude Opus 5.5 at its own default effort. The worker signs in the way Claude Code does on that machine, or with `ANTHROPIC_API_KEY`.
- Every tool call the model makes passes a guard before it runs. A refusal is shown in the change's progress.
- The second worker is a generic one for command-line agents such as Codex CLI. Such an agent has to run whole inside the container, which then needs network access limited to that agent's model endpoint. It therefore waits for the network allow-list described in §6.3.

**Several agents.** In the PoC each change has one implementing agent, and several changes can run at once, each in its own worktree. Splitting one change across several agents is designed for (every operation carries its own targets and allowed paths) and deferred.

### 6.3 Sandbox

Repository code never executes directly on the engineer's machine during a change. Installs, builds, tests, and every command an agent issues run in a container.

| Phase | Container | Network | What runs |
|---|---|---|---|
| **Prepare** | Fresh, per candidate | On | The harness installs dependencies from the lockfile, with install scripts disabled (`npm ci --ignore-scripts`) |
| **Implement** | One per candidate, for the length of the agent run | **Off** | Commands the agent issues through `Sandbox.run` |
| **Check** | Fresh, per check run | **Off**, except the optional integration tier (§9.3) | The harness's checks against the candidate commit |

- **Mounts.** The candidate's worktree and nothing else: no home directory, no host sockets, no credentials, no host environment variables.
- **Secrets.** No secret ever enters a Prepare or Implement container. A check that needs one receives it by name, from the harness, in its own Check container only. Git-ignored files such as `TestDB.env` are not part of a worktree, so agents never see them.
- **Limits.** Non-root user, read-only root filesystem with temporary scratch space, and caps on CPU, memory, process count, wall-clock time, and output size.
- **The model conversation stays outside.** The agent's exchange with its model runs in the server process, so the API key never enters a container and the containers need no network.
- **New dependencies need approval.** An agent that needs a package asks for it. Approving re-runs Prepare. A package that needs its install script must be listed in `.deck/deck.json`.
- **Checks start clean.** They run in a fresh container, so nothing the agent left running or cached can influence them.
- **Extraction runs on the host.** It parses and type-checks and executes no repository code.
- **Image.** Named in `.deck/deck.json`; the default is `node:24-slim`.
- **Prerequisite.** Docker, or Podman with its Docker-compatible CLI. On Windows this means WSL 2.
- **Without one.** `--sandbox host` runs checks and agent commands on the engineer's machine. It is opt-in, announced at start-up, and gives no isolation: a test a model wrote runs with the engineer's own access. A model may issue only the configured check commands there.

A network allow-list is the next step for the sandbox. Its first use is the optional integration tier in M4, limited to the test database's host (§9.3). Left for later: the same allow-list applied to Prepare (the package registry only) and to agents that must run whole inside the sandbox (their model endpoint only), and isolation stronger than a container.

### 6.4 Reconciliation

Compare the base snapshot with the candidate snapshot, then explain the difference using the request:

- `add_edge`, `add_block`, `rename`, and `remove` are matched structurally against the graph difference. Present means Implemented, absent means Missing.
- `set_behavior`, `add_behavior`, and plan requirements cannot be established from structure. Each is "supported by a test," "contradicted by a test," or "not tested," according to the harness checks linked to it. Not tested is shown as such and never as a pass.
- Every difference that no operation explains is Unrequested.
- The request and the base snapshot are never rewritten to match what the agent built.

### 6.5 Direct code edits

Editing code directly is always allowed. The watcher rebuilds the map, and blocks that differ from the last accepted commit carry a "changed since baseline" dot. Nothing is gated in the PoC.

## 7. Kinds of truth

Every statement on the map belongs to one layer, and the layers are never merged.

| Layer | In the PoC | On the map |
|---|---|---|
| **Requested intent** | Change operations and authored bullets | Dashed, "Requested"; `▪` bullets |
| **Agreed contract** | The approved plan and its requirement checklist | Checklist in the change panel |
| **Observed code facts** | The extracted snapshot | Solid, uncolored; `•` bullets |
| **Tested evidence** | Harness check runs, stored per commit and candidate | Tests chips; check and "Contradicted" badges |
| **Accepted baseline** | A git commit plus the committed `.deck/` files | The resting state |
| *Interpretation* | AI summaries | `◦` bullets, labeled |

- An observed call does not establish intent. A passing test supports a requirement and does not prove it for all inputs. A model's summary is never evidence.
- "Unknown," "unsupported by the extractor," "not tested," and "contradicted" are different states and are shown differently.
- The top bar shows extraction coverage: the share of call sites and imports that resolved. The map is only as trustworthy as that number.

## 8. Architecture and stack

### 8.1 Layout of this repository

```text
Double_Decker/
  packages/
    deck-model/          schemas and types for §4; pure, no I/O
    adapter-typescript/  the extractor of §5
    core/                git and worktrees, identity, reconciliation, change coordinator
    agent-gateway/       work packages and workers (§6.2)
    server/              HTTP and WebSocket API, static hosting, CLI entry
    web/                 the upper deck (§3)
  examples/shop/         the reference service (§9.1)
  fixtures/              hand-written and generated graphs for M0
  TestDB.env             test database credentials (§9.3); git-ignored, never committed
```

Packages talk only through `deck-model` types. `web` builds and runs against a fixture with no server, which is what makes M0 possible first.

### 8.2 Stack

Versions are the current releases on npm as of 2026-10-11.

| Concern | Pick | Version | Note |
|---|---|---|---|
| Runtime | Node.js LTS | 24 | |
| Workspace | npm workspaces | 11 | No extra installs |
| Language | TypeScript, strict | 7.0 | Native compiler for the platform's own type-check |
| Extraction | ts-morph | 28 | Bundles the TypeScript 6 compiler API; see the note below |
| UI | React, Vite | 19, 8 | |
| Canvas | `@xyflow/react` (React Flow) | 12 | Behind a `MapView` interface so the renderer can be replaced |
| Layout | elkjs, in a web worker | 0.12 | Handles nested areas and arrows that cross them |
| UI state | Zustand | 5 | |
| Styling | Tailwind CSS with the §3.10 tokens as CSS variables | 4 | |
| Panels, popovers, command palette | Radix primitives (`radix-ui`), cmdk | 1, 1 | |
| Code peek and diff | Shiki | 4 | Read-only highlighting |
| Server | Hono, with WebSocket | 4 | |
| Schemas | zod | 4 | Shared by server and browser |
| Tests | Vitest; Playwright for canvas and visual regression | 5, 1 | |
| File watching | chokidar | 5 | |
| Lint and format | Biome | 2 | Does not depend on the TypeScript API |
| First agent worker | `@anthropic-ai/claude-agent-sdk` | 0.3 | |
| Sandbox | Docker or Podman, driven through the CLI | | Needed from M3; not yet installed on the development machine |

**TypeScript API note.** TypeScript 7.0, the native compiler, shipped in July 2026 without a programmatic API. A new and different API is expected in 7.1. The extractor therefore uses the TypeScript 6 API that ts-morph 28 bundles, which is independent of whatever compiler the target repository uses. All compiler access stays inside `adapter-typescript`, so moving to the 7.x API later touches one package.

### 8.3 Server API

| Route | Purpose |
|---|---|
| `GET /api/deck` | Current snapshot, layout, and notes |
| `GET /api/source?path&start&end` | Source text for the code peek |
| `POST /api/open-in-editor` | Open a path and line in the configured editor |
| `PATCH /api/layout` | Save positions and collapsed state |
| `POST /api/changes`, `PATCH /api/changes/:id` | Create a change; add or edit operations |
| `POST /api/changes/:id/{submit,approve,revise,accept,reject}` | Lifecycle transitions |
| `GET /api/changes/:id/review` | Review bundle for the current candidate |
| `WS /api/events` | Snapshot patches, change state, agent progress |

### 8.4 Deployment

```text
decker <path-to-repo>     starts the local server and opens the browser
```

- The UI is entirely browser-based. The server is one Node process on the engineer's machine, because a hosted page cannot read the repository, run its toolchain, start agents in worktrees, or open an editor.
- The server binds to `127.0.0.1` only, requires a per-session token, checks the `Origin` header, and confines file access to the repository root.
- Later packaging needs no UI change: a desktop shell (Electron reuses the Node server as it is; Tauri is smaller and runs it as a sidecar), a VS Code extension hosting the same UI in a webview, or a hosted service with the server beside a cloud checkout.

## 9. Codebases and demo

### 9.1 The reference service

`examples/shop` is a small strict-TypeScript service, about 1,100 lines as built, written for this project:

- Areas: Orders, Inventory, Catalog, Payments (a stub), HTTP (a thin adapter), and Shared types.
- In-memory storage, a Supabase-backed store behind the same interface (§9.3), and a Vitest suite.
- One deliberately unsupported construct (a string-keyed handler registry) to exercise opaque markers.
- Rename fixtures to exercise identity.

The demo, carried over from v0.1:

1. The accepted map shows Orders and Inventory with no reservation interface.
2. The engineer drags an arrow from Orders to Inventory, picks **API**, labels it "Reserve stock," and adds four bullets:
   - Reserve every item before confirming an order.
   - Never reserve only part of an order.
   - Retrying the same request must not reserve stock twice.
   - Return which items are unavailable.
3. The arrow appears dashed and "Requested."
4. The plan proposes `reserve(orderId, items, idempotencyKey)`, lists atomicity, idempotency, and concurrency as requirements with a test for each, and asks about reservation expiry and persistence. The engineer chooses in-memory with no expiry. Those limits are recorded on the change and shown on the arrow.
5. The first candidate reserves items one at a time in a loop. Extraction shows the new arrow. The shortage test, run by the harness, finds a partial reservation. The atomicity requirement turns **Contradicted** and Accept is blocked.
6. The engineer presses Revise. The second candidate passes. Review shows the new API, the validation path, and the affected callers, and the engineer accepts.

For M4 the flawed first candidate is a stored patch, so detection is tested deterministically and does not depend on an agent making the mistake.

### 9.2 Real repositories

The reference service proves the loop under controlled conditions. Two public repositories prove the map on code nobody wrote for this project. Each is pinned to a commit recorded in `fixtures/repos.json` at the start of M1 so measurements can be repeated.

| | **First: Hono** (`honojs/hono`) | **Second: Supabase Storage** (`supabase/storage`) |
|---|---|---|
| What it is | A web framework library | A production file-storage backend service built on Fastify |
| License | MIT | Apache-2.0 |
| Size | About 0.8 MB of source under `src` (roughly 24,000 lines in 188 files) plus 124 test files beside the code | About 1.8 MB of source (roughly 55,000 lines in about 370 files) plus about 260 test files |
| Why | No runtime dependencies, so it maps after a plain clone with nothing installed. Strict TypeScript with no decorators or injection. Naturally drawable areas: core, routers, middleware, adapters, helpers, JSX, client, utilities. A test file beside nearly every module exercises the tests chip | The closest to what an engineer would actually drop in: routes, storage, database, queue, auth, and monitoring layers with real external dependencies. Doubles as the scale test |
| Caveats | A library, not an application: few API arrows and a hub-and-spoke shape. Uses TypeScript project references | Needs its dependencies installed for full type resolution |

Sizes are estimated from file sizes on 2026-10-11.

Jay's Grocery-insights project (a Python FastAPI backend with a plain-JavaScript React frontend) is the intended first target for a Python adapter (§12). It is not used for the TypeScript proof of concept.

### 9.3 Test database

Jay has provided a free-tier Supabase project as a test database. Its credentials are in `TestDB.env` at the top of this folder, as `SUPABASE_TEST_URL` (the project's REST URL) and `SUPABASE_TEST_KEY`.

**What it is for.** It gives the proof of concept one real external dependency to draw and to verify against. It is optional everywhere: M0 to M3 and the first demo never touch it, and a paused or unreachable database must never block the loop.

- **On the map.** The reference service gains a Supabase-backed store behind the same `StockStore` interface as the in-memory one. That puts a real External pill ("Supabase") and real "via StockStore" arrows on the map.
- **In verification.** An integration check tier runs the store's tests against the test database. It is the one check allowed onto the network, through an allow-list limited to that host.
- **As a second demo.** The first demo records "persistence across restarts" as a limit the engineer accepted. The second demo lifts it: the engineer draws an arrow from Inventory to a new External, the agent asks for a new dependency and for network access, and both requests wait for approval.

**As built.** `SupabaseStockStore` implements `StockStore`: reads are answered from memory, a write is saved in the background, and `flush` waits for it. It keeps its levels as one document in a Storage bucket, because the key allows no schema changes over REST and the project had no tables. The `integration` check in `examples/shop/.deck/deck.json` names its two secrets, the env file they are in, the test files it owns, and the one host it may reach, written as `$SUPABASE_TEST_URL` so the host itself is never committed. The harness replaces every secret, and the host of any that is a URL, with its name in whatever output it keeps. The first two bullets above are built and tested against the real project. The second demo is not built.

**Handling rules.** The key is a Supabase *secret* key, which bypasses row-level security and can read and write everything in that project.

- The project holds dummy data only.
- `TestDB.env` is git-ignored and is never committed, copied into a fixture, or pasted into a document.
- Only the harness reads it. The values go to the integration Check container and nowhere else: not to `web`, not to any agent or model prompt, not into logs, snapshots, or deck text.
- If the database is unreachable, its tests are reported as skipped, never as passed or failed.

**What it does not cover.** The file holds a REST URL and an API key, not a Postgres connection string. Mapping Supabase Storage (§9.2) needs no database at all, and that project's own test suite expects a local Postgres, so it must not be pointed at this one. A Python adapter test on Grocery-insights would need the connection string and the vector extension as well.

## 10. Budgets

These are targets to measure against, not results. Record hardware, cold and warm runs, graph size, and coverage with every measurement.

| Budget | Target |
|---|---|
| Pan and zoom, 300 blocks and 600 arrows on screen | 60 fps at the 95th percentile |
| Pan and zoom, stress fixture of 1,500 blocks and 4,000 arrows | 45 fps or better, with at most 400 blocks in the DOM |
| Select, hover, expand, open panel | Under 100 ms at the 95th percentile |
| First map, `examples/shop` | Under 3 s |
| First map, 10,000-line repository | Under 10 s cold, 2 s warm |
| First map, Hono (source plus tests) | Under 20 s cold |
| First map, 200,000-line repository | Under 60 s cold |
| Map update after a one-file edit | Under 2 s |

## 11. Milestones

**M0: The canvas.** Visuals first. Input is a hand-written `fixtures/shop.graph.json` (about 6 areas, 40 blocks, 70 arrows, 120 tests) and a generated stress fixture. No server.

- All three zoom levels, expansion, hover, selection, the detail panel, search-and-fly, the minimap, breadcrumb, camera history, the outline view, and keyboard navigation work as specified in §3.
- The tests chip and drawer work on single blocks and through `Shift+T`, in every chip state.
- The dark theme is finished. The light theme works from the same tokens.
- The pan, zoom, and interaction budgets in §10 are met and recorded.
- Positions survive a reload. Dragging and "Tidy up" work.
- **Jay signs off on look and feel. Nothing after M0 starts until then.**

**M1: Compile up.** `decker examples/shop` shows the real map.

- Extracting the same commit twice gives identical snapshots.
- Every block, operation, and arrow opens its source in the peek and in VS Code at the right line.
- IDs, layout, and authored bullets survive a file rename and a function rename.
- The unsupported construct appears as opaque, and the top bar shows coverage.
- Editing a file updates the map within budget and moves nothing else.
- Tests hang off the operations they call. Every chip shows "not run," since no harness exists yet.
- Hono produces a navigable map within budget from a plain clone, with its test files attached to the right blocks. A hand-checked sample of 30 blocks and 30 arrows matches the source.
- Supabase Storage produces a navigable map within budget, and its coverage figure is recorded.
- Everything works with no model configured. With one, summaries stream in and are labeled.

**M2: Edit the deck.**

- Every gesture in §3.8 creates an operation that is saved and survives a reload. Undo and redo work.
- No requested item can be mistaken for an implemented one, checked by visual regression tests.
- The deck text of a change reads as a clear task description.

**M3: The agent loop.** Requires Docker or Podman.

- Submit, plan, approve, implement in a worktree, check, re-extract, review, and accept all work end to end on the §9.1 demo.
- Prepare, Implement, and Check run in containers as specified in §6.3. The agent's commands and the harness's checks never execute on the host.
- Tests chips show pass and fail from harness runs at the current commit, and return to "not run" when the code changes.
- Reject leaves the working tree untouched.
- Stopping the server mid-run and restarting either resumes the change or marks it failed. The working branch is never left half-changed.

**M4: Trust.**

- The stored flawed patch is marked Contradicted by a harness-run test, and Accept is blocked.
- A fixture in which the agent edits an unrelated block is marked Unrequested.
- Two changes run in parallel worktrees. Accepting the second after the base has moved forces a rebase and a re-check.
- A fixture in which the agent deletes a failing test is flagged on the tests chip in review.
- An agent cannot write outside its worktree, reach the network, or read host files, tested with hostile instructions planted in a README and in a package script.
- An accepted change can be reverted through a revert candidate that goes through the same review.
- Optional: the second demo of §9.3 runs end to end. The integration tier reaches only the test database's host, the key appears in no log, prompt, or diff, and a paused database yields skipped tests.

**M5: Prove and extend.**

- The same engineers make a small set of representative changes through the map and code-first. Measure time to submit, review time, and missed mismatches.
- C++ spike: map one CMake project of at least 20,000 lines at all three zoom levels from its `compile_commands.json`, using clang tooling. Report coverage and extraction time, and decide whether C++ is launch language two.

## 12. After the proof of concept

**Deferred from v0.1.** Sections 6 to 10 of v0.1 remain the target design for these, and the PoC is shaped so they can be added without rework:

- Content-addressed evidence storage and hashed baseline manifests. The PoC uses git commits.
- Compare-and-swap acceptance with reviewer authority. The PoC has one user and a base-commit check.
- The rest of the sandbox. The PoC has containers with the network off and, optionally, an allow-list for one host (§6.3). A general allow-list, agents running whole inside the sandbox, and isolation stronger than a container come later.
- A structured contract editor. The PoC uses the plan's requirement checklist.
- Runtime observation, property tests, and performance comparison of generated code.
- A custom language, considered only after documenting recurring failures of the existing-language approach.

**C++ as the second language.** The deck model, UI, and change loop do not change. The new work is one adapter built on clang tooling. It requires a compilation database from the project's build system. The expected mapping is: directories and namespaces become areas, a header and source pair or a class becomes a block, public member functions and free functions declared in headers become operations, and Doxygen comments become declared bullets. "Open in editor" targets Visual Studio. The known difficulties are macros, templates, extraction time on large codebases, and slower agent build-and-test cycles.

**Python.** A Python adapter is the cheapest next language, because Pyright, the Python type checker, is itself a Node program and can be driven from the platform without a second toolchain. Docstrings map directly onto declared bullets. Its first target would be Jay's Grocery-insights project, whose map would run end to end from the React frontend through the FastAPI routes to the RAG pipeline, providers, and database, with the frontend's `fetch` calls matched to backend routes as API arrows. Whether Python is slotted in before C++ is an open item (§14).

**More languages.** Evaluate ingesting SCIP indexes, which exist for TypeScript, C++, Java, Python, Go, and Rust, as a way to reach many languages with one generic adapter of lower fidelity.

## 13. Risks

| Risk | Response |
|---|---|
| A beautiful map creates false confidence | Bullet origins, coverage in the top bar, opaque markers, stored-defect tests |
| AI bullets that sound right and are wrong | Labeled, cited to source spans, never used as evidence, pin or dismiss |
| The DOM canvas slows down on large maps | 400-block cap through zoom levels, stress fixture in M0, replaceable `MapView` |
| The TypeScript compiler API is in transition | Pinned ts-morph, all compiler access in one package |
| Layout jumps between rebuilds | Saved positions, place-only-new rule, explicit "Tidy up" |
| TypeScript is the easy case and flatters the approach | The C++ spike in M5 is the honest test |
| Agent runs are slow or expensive | Plan approval before implementation, bounded work packages, budgets |
| A test count is read as coverage | Attribution is labeled "calls directly"; status comes only from a harness run at the current commit |
| Containers are escapable, and Prepare has open network access | Install scripts disabled, nothing mounted but the worktree, no credentials inside; allow-list and stronger isolation later |
| Worktrees mounted from Windows are slow inside containers | Measure in M3; move dependency folders to a container volume if needed |
| The test database key is a secret key with full access to that project | Dummy data only; git-ignored; read only by the harness; never in agent containers, prompts, or logs (§9.3) |
| A free-tier database pauses when idle | Optional everywhere; unreachable means skipped, never failed |

## 14. Decisions log and open items

Decided with Jay on 2026-10-11:

| Question | Decision |
|---|---|
| Who implements, and who summarizes | Claude first, for both |
| Which real codebases | Hono first, Supabase Storage second (§9.2). Grocery-insights waits for a Python adapter |
| How much of v0.1's trust machinery | The lean set in §6 and §7, plus a container sandbox (§6.3) |
| Look | Dark-first |
| Tests on the map | A collapsed chip per block that expands in place (§3.7) |
| Test database | A free-tier Supabase project, credentials in the git-ignored `TestDB.env`; optional, for the integration tier and second demo (§9.3) |

Still open. None of these blocks M0 to M2:

- **A container runtime is not installed on the development machine.** It has neither Docker nor WSL 2. M3 was built and tested in host-sandbox mode instead. One of Docker Desktop or Podman, on WSL 2, is needed to run and verify the container sandbox.
- **The Claude worker has not completed a run.** Jay approved Claude Haiku 5.5 at medium effort for testing. The Claude Code sign-in on the development machine had expired, so the first attempt made no model call. After `claude auth login`, `DECKER_LIVE=1 npx playwright test live-agent` runs the demo request and the hostile-instruction test against the real model.
- **Zooming at the Architecture level on a 300-block map misses its frame-rate target.** Each card or arrow that comes into view is mounted as a component, and several dozen at once take 40 to 60 ms. Drawing arrows on one canvas, or mounting them a little ahead of the screen edge, are the two ways to fix it.
- **Look and feel sign-off.** M0's gate was skipped at Jay's instruction. His review of the map is still owed.
- **Python before C++?** C++ remains launch language two. A Python adapter is cheaper and would let Jay map his own projects. Decide at M5.
- **Tests on arrows.** The PoC attaches tests to arrows only through a change's requirements. Whether to attribute integration tests to the arrows they cross is undecided.

## Appendix A: Research behind the decisions

Gathered 2026-10-11.

### First language

| | TypeScript | C++ | Rust | Go | Python |
|---|---|---|---|---|---|
| Reach | Most-used language on GitHub by monthly contributors since Aug 2025 (2.6M, up 67% in a year); about 49% of professional developers | About 22% of professional developers; 3rd on the TIOBE index (Sep 2026) | About 15% | About 17% | 2nd on GitHub; 1st on TIOBE |
| Building a truthful map | Compiler API gives resolved symbols, types, and calls in-process from a `tsconfig.json`; cost is about one type-check | Needs a working build and a compilation database; headers, macros, and templates multiply the work | Good tooling, but routes, derives, and async runtimes are generated by macros | Simple and explicit; excellent standard tooling | Dynamic typing makes call targets guesswork |
| Check-and-test cycle | Seconds; the TS 7 native compiler is roughly 8 to 12 times faster than TS 6 | Minutes on real projects | Slow builds | Fast | Fast, with weak static checks |
| Agents (SWE-bench Multilingual, Claude 3.7 Sonnet) | 34.9% (JS/TS) | 28.6% (C/C++), the lowest | 58.1%, the highest | 31.0% | Not in this benchmark |
| Same language as the platform | Yes | No | No | No | No |
| Speed of the resulting program | Adequate for services | Best | Best | Very good | Slowest |

Notes on the evidence:

- The agent benchmark is one older model on 300 tasks. Treat it as indicative. Its clearest signal is that C/C++ is the hardest place to start an agent loop.
- Stack Overflow figures come from a secondary summary of the 2025 survey.
- For scale on C++ extraction: Sourcegraph's scip-clang announcement reports one 480,000-line project expanding to 26 million lines after preprocessing, indexing at 1.3 to 1.5 times the cost of type-checking every translation unit, no incremental indexing, and one to two hours for large codebases on a high-core-count machine.
- scip-typescript reports indexing at roughly the cost of a type-check.

### Platform language

TypeScript, because the three heaviest jobs are already done by something else: parsing and type-checking by the TypeScript compiler, layout by ELK in a worker, and drawing by the browser's compositor. C++ or Rust for the platform would add a second toolchain and buy speed where the PoC has no bottleneck. If one appears later (layout or graph diffing on very large repositories), that single piece can move to Rust compiled to WebAssembly.

### Canvas

| Option | For | Against |
|---|---|---|
| **React Flow (`@xyflow/react`)** | Blocks are real DOM, so text is crisp at every zoom and styling is ordinary CSS; drag-to-connect, nested groups, and a minimap are built in; MIT | DOM-based, with a practical limit around 1,000 rendered nodes, handled here by zoom levels and culling |
| tldraw SDK | Excellent camera feel | Commercial production use requires a paid license key; built for whiteboards, not graphs |
| WebGL (Sigma.js, PixiJS) | Tens of thousands of nodes | Text-dense, editable cards and accessibility would all be custom work |

### Real repositories considered

Checked on GitHub on 2026-10-11. Sizes are TypeScript source excluding tests, estimated from file sizes.

| Repository | License | Source size | Verdict |
|---|---|---|---|
| `honojs/hono` | MIT | About 24,000 lines | **First.** Dependency-free, cleanly layered, a test beside nearly every module |
| `supabase/storage` | Apache-2.0 | About 55,000 lines | **Second.** A real production service with layered internals |
| `epicweb-dev/epic-stack` | MIT | About 10,000 lines | Good small full-stack alternative; file-based routing and a generated database client complicate a first extraction |
| `peers/peerjs-server` | MIT | About 1,000 lines | A real service, and too small to stress anything |
| `gothinkster/node-express-realworld-example-app` | None stated | About 1,500 lines | Rejected: no license and no commits since May 2024 |
| `umami-software/umami`, `actualbudget/actual` | MIT | 4.7 MB and 9.5 MB of TypeScript | Too large for a first target |

### Similar products

- **Windsurf Codemaps** (Cognition, Oct 2025): AI-annotated maps of a codebase for a given task. Read-only snapshots.
- **CodeViz** (YC S24): diagrams from code inside VS Code. Its changelog lists diagram-to-code as "on the horizon."
- **GitHub Next repo visualization** and older tools (CodeSee, Sourcetrail, Visual Studio Code Map): one-way, code to picture.

No shipping product was found that lets an engineer edit the map, dispatches the edits to agents, and returns an evidence-backed visual diff. That loop, and the truth labeling around it, is what Double Decker adds.

### Sources

- GitHub Octoverse 2025: https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/
- Stack Overflow Developer Survey 2025: https://survey.stackoverflow.co/2025/technology/ (figures via https://www.secondtalent.com/resources/top-programming-usage-statistics/)
- TIOBE, September 2026: https://www.techrepublic.com/article/news-tiobe-september-2026-julia-nears-top-20/
- Announcing TypeScript 7.0: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- ts-morph releases: https://github.com/dsherret/ts-morph/releases
- SWE-bench Multilingual: https://www.swebench.com/multilingual.html
- scip-clang: https://github.com/sourcegraph/scip-clang
- scip-typescript: https://github.com/sourcegraph/scip-typescript
- React Flow performance guide: https://reactflow.dev/learn/advanced-use/performance
- React Flow layout guide: https://reactflow.dev/learn/layouting/layouting
- tldraw license: https://tldraw.dev/legal/tldraw-license
- Windsurf Codemaps: https://cognition.ai/blog/codemaps
- CodeViz changelog: https://open-vsx.org/extension/CodeViz/codeviz/changes
- Hono: https://github.com/honojs/hono
- Supabase Storage: https://github.com/supabase/storage

## Appendix B: Changes from v0.1

- **Visuals first.** The upper deck moved from §11 to §3 and grew from a few paragraphs into a buildable design: elements, zoom levels, camera, editing gestures, review, visual tokens, and layout rules. A new milestone, M0, builds and approves it before anything else.
- **First language changed from Rust to TypeScript**, with C++ named as second. Appendix A has the evidence.
- **Platform, canvas, storage, and deployment are decided** (§2, §8). v0.1 left them open.
- **Bullets are specified**: where they come from, how each origin is marked, and how AI summaries are kept separate from facts.
- **The edit vocabulary is specified**: six operations, where v0.1 had only the draw-an-arrow example.
- **Tests are on the map** as a collapsed chip per block that expands in place (§3.7). v0.1 treated tests only as evidence during review.
- **The trust machinery is staged.** The five kinds of truth and their visual separation are kept, and agents and checks run in containers with the network off. Hashed manifests, the evidence store, and the contract editor are deferred (§12), with git standing in for the PoC.
- **Real codebases are named**: Hono, then Supabase Storage (§9.2).
- **Performance targets for the generated program and the platform matrix** are deferred, since the PoC measures the loop and the map.
- **Milestones are reordered** around the canvas, with testable completion criteria for each.
