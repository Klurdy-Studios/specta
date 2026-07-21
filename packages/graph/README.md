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
- `nextEligibleEpic()` uses Roadmap order, explicit Epic dependencies, latest
  approved or scaffolded Technical Designs, and graph-backed implementation
  status directly from graph nodes and relationships. It never returns an
  in-progress, blocked, or completed Epic.
- `createWorkflowStateRepository()` reads and atomically checkpoints
  `WorkflowRun` and `EpicImplementationState` nodes and their relationships.

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
