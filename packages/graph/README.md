# Graph public API

`@specta/graph` owns Specta's canonical Workspace Graph. Each initialized
Workspace is persisted with TypeGraph and SQLite at
`.specta/graph/workspace.sqlite`; legacy JSON shards are validated and imported
once, then left unchanged.

## Ontology and persistence

- `workspaceGraph` defines planning, technical-design, workflow, source, test,
  project, and implementation-state nodes and their allowed relationships.
- `createSqliteWorkspaceGraphProvider()` opens a bounded `WorkspaceGraphSession`.
  A session exposes `queries`, transactional `projections`, and exact domain
  documents. `transaction()` keeps document reads, revision checks, and graph
  updates under the same SQLite transaction. `workspaceGraphDatabasePath()`
  returns its canonical file path.
- `GraphProjectionWriter.apply()` incrementally diffs one owned projection.
  `applyMany()` commits several projections in one SQLite transaction. Stable
  fingerprints avoid rewriting unchanged entities and stale owned entities are
  removed without deleting entities still owned by another projection.
  Projection priorities deterministically merge shared entity properties and
  restore the remaining owners when a higher-priority owner is removed.
- `createGraphEdgeId()` creates deterministic relationship IDs.

## Queries and workflow state

- `WorkspaceGraphQueries` provides node lookup, kind-filtered listing, bounded
  neighborhood traversal, dependency/dependent traversal, and
  `nextEligibleEpic()`.
- `searchNeighbors()` delegates bounded neighborhood discovery to TypeGraph's
  native set-based breadth-first graph algorithm and returns minimum traversal
  depth with each node.
- `nextEligibleEpic()` uses Roadmap order, explicit Epic dependencies, latest
  approved or scaffolded Technical Designs, and graph-backed implementation
  status directly from graph nodes and relationships. It never returns an
  in-progress, blocked, or completed Epic.
- `createWorkflowStateRepository()` reads and atomically checkpoints
  `WorkflowRun` and `EpicImplementationState` nodes and their relationships.
  Complete and validation-failed implementation checkpoints require an aligned
  Validation Report and persist all three states in one transaction. A passing
  checkpoint must come from an `implement` run and cover its Epic, every Story
  and acceptance criterion, every Architecture component, an approved Technical
  Design, verified tests, and implemented files.

## Validation reports

- `createValidationReportRepository()` stores exact reports and projects a
  compact `ValidationReport` node with `VALIDATES` provenance to the Epic and
  checked graph entities.
- `validationReportProjection()` is public for transactional composition by
  workflow repositories. Reports associated with an Implementation Run must
  target the same Epic.

## Context Engine

- `createContextEngine()` compiles the smallest sufficient implementation
  packet for one Epic. Required Stories, Tasks, acceptance criteria,
  architecture constraints, and the latest approved Technical Design are never
  removed to satisfy a token budget.
- Relevant source files, symbols, imports, dependencies, and tests are selected
  through TypeGraph's bounded neighborhood search with deterministic domain
  ranking. Required predecessor interfaces are resolved to their canonical
  graph file and symbol IDs. Packets reference source paths and signatures
  instead of embedding complete source files.
- Supplying `implementationRunId` persists an immutable Context Packet through
  `createContextPacketRepository()`. Repeated compilation returns the exact
  packet associated with that run, allowing a native coding-agent workflow to
  resume deterministically.
- `renderContextPacket()` renders the structured packet as concise Markdown for
  a coding agent. `estimateContextTokens()` exposes Specta's deterministic
  dependency-free token approximation. Context budgets measure this rendered
  agent packet and remove lowest-ranked optional items until it fits; required
  specifications remain present and produce an explicit over-budget diagnostic
  when they cannot fit.
- Every packet includes a blast-radius summary. TypeGraph incoming neighborhood
  searches find direct consumers, two-hop transitive consumers, affected tests,
  and dependent Epics. Impacted entities remain summaries rather than being
  promoted into editable source context. Each section reports its total count
  and retains the first 50 deterministic results, with `truncated` indicating
  that additional impacts exist.

Run `specta context <epic-id>` to inspect Markdown context, or add `--json` for
the structured packet. `--max-tokens <count>` changes the optional-context
budget. `--run <implementation-run-id>` is intended for the graph-backed
prepare/resume protocol implemented by an agent-oriented workflow.

## Domain repositories

- `createPlanningGraphRepository()` stores validated incremental planning state.
- `createTechnicalDesignGraphRepository()` stores Technical Design revisions;
  `saveDesignsAndProfiles()` commits designs and project profiles together.
- `createProjectProfileRepository()` stores deterministic project/framework
  evidence.
- `createScaffoldRunRepository()` stores prepare/finalize state;
  `saveWithDesign()` atomically finalizes the run and Technical Design.
- `createAnalysisGraphRepository()` gives validated access to compiled source
  and specification analysis.

`planningGraphSnapshotSchema`, `technicalDesignGraphSnapshotSchema`, and
`parsePlanningGraphSnapshot()` remain public solely for validated legacy import.

## Analysis and parser extension API

`createWorkspaceAnalyzer()` discovers supported files, parses them, resolves
imports, projects graph nodes and relationships, and incrementally persists the
analysis projection. `createStableGraphId()` creates portable IDs from a node
kind, project root, and project-relative identity.

Run `specta compile` from an initialized workspace to update analysis. The
initial language adapter supports `.ts`, `.tsx`, `.mts`, and `.cts`; the
specification adapter supports Markdown under `.spec/` and generated planning
documents under `.specta/planning/`.

`@specta/graph/parser` exports `SpecificationParser`, `LanguageParser`,
`ModuleResolver`, `ParserInput`, `ParserRegistry`, and `createParserRegistry()`.
It also exports the built-in `markdownSpecificationParser` and
`typeScriptLanguageParser`. Language adapters own syntax-specific module
resolution; discovery, persistence, IDs, and projection remain
language-independent.

TypeGraph reserves `id`, `kind`, and `meta`, so graph properties use `fileKind`,
`symbolKind`, and `projectKind` where the corresponding domain model uses
`kind`.
