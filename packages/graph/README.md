# Graph public API

- `workspaceGraph` defines Specta's planning, technical-design, specification,
  source, dependency, and test ontology
  using TypeGraph and the canonical Zod schemas from `@specta/core`.
- `planningGraphSnapshotSchema` validates the temporary JSON graph snapshot
  format used before the SQLite TypeGraph backend is introduced.
- `analysisGraphSnapshotSchema` validates the persisted full analysis rebuild
  at `.specta/graph/analysis.json`.
- `createWorkspaceAnalyzer()` discovers supported files, parses them, resolves
  imports, projects graph nodes and relationships, and persists the result.
- `createAnalysisGraphRepository()` gives later workflows validated read access
  to compiled specification and source analysis.
- `createStableGraphId()` creates portable IDs from a node kind, project root,
  and project-relative identity.

Run `specta compile` from an initialized workspace to rebuild its analysis
graph. The initial language adapter supports `.ts`, `.tsx`, `.mts`, and `.cts`;
the specification adapter supports Markdown under `.spec/` and generated
planning documents under `.specta/planning/`.

## Parser extension API

`@specta/graph/parser` exports `SpecificationParser`, `LanguageParser`,
`ModuleResolver`, `ParserInput`, `ParserRegistry`, and `createParserRegistry()`.
It also exports the built-in `markdownSpecificationParser` and
`typeScriptLanguageParser`. A parser returns canonical contracts from
`@specta/core` and diagnostics with one-based lines and zero-based columns.

Language adapters declare their extensions and own syntax-specific module
resolution. Discovery, persistence, IDs, and graph projection remain
language-independent. The TypeScript adapter resolves relative imports,
workspace packages, `tsconfig.json` path aliases, and imported assets.

TypeGraph reserves `id`, `kind`, and `meta`, so graph properties use
`fileKind` and `symbolKind` when the corresponding domain model uses `kind`.

The graph package owns ontology, graph validation, traversal and persistence
adapters. This version intentionally performs a complete deterministic rebuild;
Epic 005 owns the unified graph database and Epic 011 owns incremental caching
and performance.
