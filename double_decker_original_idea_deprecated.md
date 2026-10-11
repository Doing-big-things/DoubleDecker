# Double Decker Bus Programming System

**Design specification v0.1 · 2026-10-10 · Dallas**  
**Concept owner: Jay Reed**  
**Status: Proposed architecture for an initial prototype**

## 1. The idea

Double Decker Bus is a programming system with two connected working surfaces.

The **lower deck** contains efficient, portable implementation code. AI coding agents such as Astra and Opus do much of the implementation work here. Engineers can inspect and edit it directly.

The **upper deck** presents the program as an editable map of components, functions, interfaces, data, and interactions. Engineers work primarily with shapes, connections, and plain-English behavior. They can move from architecture down to a function and its source without losing context.

The central interaction is concrete: draw a line between two components, label it “API,” describe what it should do, and submit that change. The system saves a versioned request, asks an agent to implement it, rebuilds the map from the resulting code, and presents the difference for engineering review.

The upper deck is an active programming surface. A diagram edit initiates a governed implementation change. The returned diagram must describe the candidate implementation, including unexpected changes and unresolved questions. A polished description alone cannot complete the loop.

The initial product should demonstrate this loop on an existing language. A custom language can follow if experience reveals semantics that existing languages cannot express or expose adequately.

## 2. Product contract

An engineer should be able to:

1. Open a repository and see a navigable architecture and function map.
2. Select a component or interaction and inspect its source and evidence.
3. Propose a behavior change through the map without editing implementation code.
4. Review the agent’s interpretation before authorizing implementation.
5. See the implemented result as a semantic visual diff, backed by source changes and checks.
6. Accept, revise, reject, or roll back a candidate without losing the original request.

The system must preserve disagreements between intention and implementation. It must never quietly rewrite the request to match what the agent happened to build.

A first successful demonstration is an engineer adding an Orders-to-Inventory reservation API, watching an agent implement it, discovering a meaningful mismatch in the returned map, correcting it, and accepting the verified revision.

## 3. Five separate kinds of truth

Every assertion belongs to a named layer:

- **Requested intent:** What the engineer asked for, including original wording and later clarifications.
- **Agreed structured contract:** The reviewed interpretation of that intent: types, operations, error cases, invariants, constraints, and explicit unknowns.
- **Observed code facts:** What a particular extractor can establish about a particular source snapshot. Examples include a declared function, an import, or a resolved call site.
- **Tested evidence:** Results of named checks under recorded conditions. Passing examples support particular claims; they do not establish universal correctness.
- **Accepted baseline:** A specific implementation and its associated map, contract, evidence, and human acceptance record.

These layers are linked, never collapsed. An observed call does not establish business intent. An agreed invariant is not automatically an observed fact. A passing test does not prove an invariant for all executions.

“Unknown,” “unsupported by this extractor,” “not tested,” and “contradicted” are different states. Unknown semantics stay unknown until new evidence or an explicit engineering decision resolves them. Model-written summaries are labeled interpretations and cite their inputs.

## 4. Prototype scope

Use one Rust repository, one pinned toolchain, and a deliberately limited set of supported patterns. Rust is a proposed implementation target, chosen to explore explicit interfaces, efficient execution, and portability. This is a design choice, not a claim that the prototype has already achieved those properties.

Start with a modular service containing ordinary functions, structs, explicit interfaces, and a thin HTTP adapter. Support components, public operations, data types, calls, and declared external dependencies. Provide architecture, component, and function views over the same model.

Initially exclude arbitrary framework inference, complex macro-generated architecture, complete dynamic dispatch resolution, polyglot repositories, production deployment, and automatic database migration. Unsupported constructs remain visible as opaque boundaries.

The prototype need not introduce new syntax, a runtime interpreter, or its own compiler. Its “high-level compilation” pipeline extracts and reconciles a graph from code and contracts. It does not promise perfect round-trip translation between arbitrary prose, diagrams, and programs.

## 5. Concrete interaction example

The accepted map contains Orders and Inventory with no reservation interface. The engineer draws an edge:

```text
Orders -- API: Reserve stock --> Inventory

Reserve every item before confirming an order.
Never reserve only part of an order.
Retrying the same request must not reserve stock twice.
Return which items are unavailable.
```

The draft edge appears dashed and marked **Requested**. It is not shown as implemented.

The system proposes a contract:

- Operation: `reserve(order_id, items, idempotency_key)`.
- Success: reservation identifier and the reserved items.
- Failure: structured shortage or invalid-request result.
- Atomicity: all requested items are reserved together, or none are.
- Idempotency: the same key and payload return the original result; a changed payload with that key returns a conflict.
- Concurrency: stock cannot become negative when requests race.
- Open decisions: reservation expiry, persistence across restarts, authentication, and transport timeout behavior.

The engineer chooses a bounded prototype: in-memory storage, no automatic expiry, process-local idempotency, and a development-only HTTP adapter. The UI warns that restart persistence and production access control remain outside the accepted scope. It must not imply that the original broad requirement is satisfied beyond those limits.

The agent implements the contract in an isolated branch. Checks include successful reservation, multi-item shortage, duplicate replay, changed-payload conflict, and concurrent requests for the last unit.

Suppose the code loops over items and reserves each immediately. Extraction may establish the loop and calls, but cannot necessarily infer the all-or-nothing violation. A shortage test exposing a partial reservation provides specific contradictory evidence. The upper deck marks atomicity **Contradicted** and links the failed test; the candidate cannot meet the mandatory acceptance gate.

After repair, review shows the new API, validation path, shared-state synchronization, and affected callers. The engineer inspects evidence, accepts the exact candidate, and establishes the next baseline. Deployment remains a separate action.

## 6. Persistent model and identifiers

Store the canonical model as versioned, schema-validated records alongside the repository. Keep large logs in a content-addressed evidence store. Use an append-only change journal for lifecycle events and a transactional pointer to the accepted baseline.

Stable IDs identify logical entities across revisions. Names, paths, and line numbers are mutable attributes. A source span helps navigation but must never be the sole identity. New entities receive opaque IDs; deleted entities retain tombstones. Ambiguous renames require review rather than silent identity reassignment.

An illustrative node record:

```yaml
schema_version: 1
id: cmp_inventory
revision: 7
kind: component
name: Inventory
parent_id: system_shop
source_bindings:
  - symbol_id: sym_reserve
    path: src/inventory.rs
    qualified_name: inventory::reserve
provenance:
  source_snapshot: sha256:SOURCE_TREE
  extractor: rust_adapter_v1
  extractor_config: sha256:CONFIG
  build_configuration: debug-default
  recorded_at: 2026-10-10T22:10:00-05:00
```

A change record keeps interpretation separate from evidence:

```yaml
id: change_042
revision: 3
base_baseline: baseline_009
base_source: sha256:BASE_TREE
intent:
  author: engineer_jay
  text: Reserve all items atomically and make retries safe.
contract_revision: contract_042_r2
operations:
  - op: add_edge
    id: edge_orders_inventory_reserve
    from: cmp_orders
    to: cmp_inventory
    kind: api
    operation: reserve
requirements:
  - id: req_atomic
    text: Reserve all requested items or none.
    mandatory: true
    assessment: supported_by_tests
    evidence_ids: [test_shortage_081, test_concurrency_082]
unknowns: [restart_persistence]
state: awaiting_review
candidate_source: sha256:CANDIDATE_TREE
```

Every evidence record includes the exact source and contract revisions, check definition, runner and tool versions, environment, inputs or fixture hashes, outcome, logs, and timestamp. Assessments include their method and provenance; confidence scores never substitute for evidence categories.

A baseline manifests the source snapshot, contract set, graph snapshot, evidence bundle, unresolved limitations, reviewer, and acceptance time. Hash immutable artifacts first, then hash the manifest that references them; exclude its own hash and mutable pointers from that payload to avoid circular hashes. Acceptance atomically advances one pointer to this complete manifest. A graph alone cannot be an accepted baseline.

## 7. Change lifecycle and concurrency

The normal state machine is:

```text
Draft -> Needs clarification -> Ready -> Implementing
      -> Extracting -> Verifying -> Awaiting review -> Accepted
```

Clear intent can move directly from Draft to Ready. Implementation requires an agreed contract and approved execution scope. Blocked, Failed, Rejected, Superseded, and Cancelled are explicit outcomes with reasons. Revision requests create a new candidate iteration; they preserve prior artifacts.

Acceptance is an atomic compare-and-swap against the expected baseline. It verifies that mandatory gates passed, the reviewed hashes still match, and the reviewer has authority. It cannot accept a different candidate merely because a branch name is unchanged.

Concurrent changes operate in separate workspaces. Requests record expected entity revisions and their base snapshot. Before acceptance, recompute overlap in contracts, code, and dependencies. Apparent graph independence is insufficient because components may share state or configuration. If the baseline moved, rebase or merge into a new candidate, regenerate the map, rerun affected checks, and request review again.

Direct code edits are allowed. They produce observed drift rather than automatically becoming approved intent. The engineer can accept the intentional change through the same review mechanism or restore the baseline.

Rollback creates an audited revert candidate against the current baseline. Reverting to an old source snapshot requires fresh checks against current dependencies and configuration. External side effects and data migrations may be irreversible; the system must never promise that reverting code reverses those effects.

## 8. Extraction and reconciliation

### Extraction pipeline

1. Freeze and hash the source tree, dependency lockfile, build configuration, and adapter configuration.
2. Parse supported syntax and gather compiler-backed information where the adapter can obtain it reliably.
3. Extract declarations, ownership, signatures, imports, and supported reference and call relationships.
4. Attach source locations, extraction method, and configuration scope to each fact.
5. Group facts using explicit component manifests first; propose inferred groupings separately.
6. Emit unresolved references and opaque regions, validate the graph schema, and publish an immutable snapshot.

Parsing or compiler failure produces a partial graph with visible coverage gaps. It cannot certify the old graph as current. Runtime observations, if added later, describe executed paths under recorded conditions rather than a complete call graph.

### Identity and incremental updates

Match entities first by explicit identity bindings, then compiler symbol identity where available, then conservative structural candidates. Use paths and similarity only to suggest a mapping. Splits, merges, and uncertain renames receive explicit identity decisions.

Cache extraction by source content and tool configuration. Recompute changed units and invalidated dependents; configuration or adapter changes invalidate affected caches. Keep a reproducible full-extraction mode to detect incremental errors.

### Reconciliation algorithm

Compare the base and candidate observed graphs, then assess that delta against the requested operations and agreed contract. Classify findings as expected changes, missing requested changes, unexpected changes, contradictions, or unresolved questions.

For each requirement, collect supporting and conflicting facts and checks. A signature comparison can establish interface compatibility within supported rules. It cannot establish idempotency or atomicity merely from a function name. A language model may suggest additional checks but cannot relabel its inference as compiler evidence.

Emit a review bundle containing the semantic delta, source diff, requirement assessments, affected dependencies, limitations, and evidence links. Never overwrite the base graph or intent during reconciliation.

## 9. Agent protocol and execution security

An agent receives a bounded work package: request ID and revision, agreed contract, source snapshot, allowed paths, supported commands, resource budgets, required checks, and explicit exclusions. Astra and Opus are interchangeable implementation workers behind this protocol; no particular model is assumed to be available or authoritative.

The agent returns a patch, implementation notes, requirement-to-code mapping, proposed tests, unresolved questions, and any requested scope expansion. It must stop for clarification when a decision would materially alter the contract.

Run code and tests in isolated, disposable environments with no production credentials, host sockets, or ambient access to the engineer’s machine. Default network access to denied; allow only approved dependency sources when required. Apply time, memory, process, filesystem, and output limits. Repository scripts and downloaded packages are executable inputs and receive the same containment.

Treat comments, README files, dependency content, and agent output as untrusted data. They cannot grant permissions or alter acceptance policy. Protect secrets from prompts and logs; record what repository content leaves the boundary for an external model provider and require organizational authorization for that destination.

An agent cannot approve its own work, expand network access, deploy, publish packages, mutate protected branches, or weaken required checks. Changes to tests, contracts, and validation policy receive conspicuous review. Run independent checks from the approved harness where feasible; an agent-supplied “all tests passed” sentence is not evidence.

## 10. Verification and engineering review

Use layered checks: schema validation, formatting, compilation, static checks, contract compatibility, unit and integration tests, property tests where justified, and targeted performance measurements. Record skipped and flaky checks distinctly from passes.

Verify the verifier through fixtures with deliberate defects: partial reservations, lost idempotency state, incompatible responses, hidden dependencies, and unrelated code changes. The review UI should expose these without requiring an engineer to discover every defect in a raw patch.

Tests sample behavior. Static extraction has language and configuration limits. Neither establishes complete functional correctness, security, or portability. Review must show which claims are supported, which are contradicted, and which still require judgment.

Mandatory contradictions, stale artifacts, failed required checks, and unresolved contract decisions block acceptance. An engineer may explicitly accept a documented limitation when policy permits; doing so creates a reviewed scope change, not a hidden passing result.

## 11. Upper deck experience

Start with a small architecture view showing component responsibility and major interactions. Expand a component into operations, data, and functions. Reveal internal call edges on demand. Maintain stable layout between revisions so movement does not masquerade as architectural change.

Every edge shows direction and interaction kind: call, API, event, read, write, or dependency. “API” opens a contract editor rather than acting as an empty label. Plain-English edits become persistent proposed changes; moving a shape for readability changes only layout.

Use text badges and line patterns alongside color to distinguish Requested, Implemented candidate, Accepted, Contradicted, and Unknown. Support keyboard navigation, searchable entity lists, and a textual equivalent of the graph.

The review view separates:

- Requested versus implemented changes.
- Base versus candidate structure and contracts.
- Expected versus unexpected dependencies.
- Behavioral evidence versus untested claims.

Selecting a changed edge reveals its contract diff, source locations, checks, and unresolved questions. Provide ordinary code review beside the graph. Abstraction should reduce review effort while preserving the ability to inspect what it hides.

## 12. System modules and boundaries

- **Repository adapter:** Freezes source snapshots and manages isolated candidate workspaces.
- **Language adapter:** Extracts supported facts and reports coverage limitations.
- **Graph store:** Maintains identities, revisions, provenance, and immutable snapshots.
- **Intent and contract service:** Captures edits, clarifications, and structured requirements.
- **Change coordinator:** Owns lifecycle transitions, concurrency, budgets, and authorization.
- **Agent gateway:** Sends bounded jobs and receives candidate patches.
- **Verification runner:** Executes approved checks and persists evidence.
- **Reconciler:** Produces requirement assessments and semantic differences.
- **Review application:** Presents the upper deck and records exact-snapshot decisions.

For the MVP these can live in one application with strict interfaces. Use local files and a transactional local store before introducing distributed services. The runtime application must work without the diagram service or an online model.

## 13. Performance and portability targets

Measure two systems separately: the developer experience and the generated program.

For a pinned reference repository of roughly 10,000 source lines, initial prototype targets are a first structural map within 10 seconds, a supported single-file incremental update within 2 seconds, and ordinary graph interactions under 100 milliseconds at the 95th percentile. These are proposed engineering budgets, not measured results. Record hardware, cold and warm runs, graph size, and extraction coverage.

For generated code, compare latency, throughput, peak memory, binary size, and startup time against an accepted hand-written baseline on identical workloads. Set regression limits per project before implementation. Any performance exception requires review; architectural neatness alone cannot justify it.

Define an initial platform matrix and run builds and tests for each target. Keep operating-system dependencies explicit in the map. A successful cross-compilation is useful evidence but does not establish runtime correctness on that platform.

## 14. Milestones and acceptance criteria

**M1: Trustworthy map.** Extract the reference repository twice with identical semantic output. Preserve IDs through a tested rename. Expose an unsupported construct as unknown. Navigate every displayed supported fact to its evidence.

**M2: Persistent visual request.** Draw the Orders-to-Inventory edge, write features, review the structured contract, and reload the application without losing request history. No draft appears as accepted implementation.

**M3: Full agent loop.** Execute an isolated agent job, ingest its patch, rebuild the map, run checks, and present a candidate. Detect the deliberately flawed partial-reservation implementation through the approved test harness.

**M4: Safe acceptance.** Accept an exact candidate, reject another, recover after a coordinator restart, prevent stale concurrent acceptance, and complete an audited revert. Demonstrate that the agent cannot alter the accepted pointer.

**M5: Useful engineering workflow.** Engineers complete a small set of representative changes using the map. Measure completion time, review time, missed mismatches, extraction coverage, and performance budgets against the existing code-first workflow. Expand only when the upper deck demonstrably helps.

## 15. Risks and decisions still open

The largest risk is false confidence from an attractive but incomplete map. Coverage indicators, provenance, opaque boundaries, and deliberate-defect testing are core product features.

Other risks include unstable identity across refactors, diagrams overwhelmed by detail, expensive agent iteration, weak tests, hidden coupling, and contracts that are more precise-looking than their actual meaning. Address these through conservative matching, progressive abstraction, bounded jobs, independent checks, and explicit unknowns.

Before implementation, decide the first repository, supported Rust patterns, target platforms, model-provider data policy, acceptance authority, and benchmark hardware. Decide whether the first UI is a standalone application or an editor extension after testing the core interaction.

A custom language should be considered only after documenting concrete recurring failures of the existing-language approach. Potential reasons include first-class architectural boundaries, enforceable effects, or stronger interface semantics. The decision must account for compiler maintenance, ecosystem access, debugging, interoperability, and migration.

The first deliverable is the working two-deck loop: engineers express architecture and behavior, agents implement bounded changes, the system reconstructs an evidence-backed view, and engineers decide whether the result matches their intent.
