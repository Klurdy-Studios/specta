# Graph public API

- `workspaceGraph` defines Specta's planning and technical-design ontology
  using TypeGraph and the canonical Zod schemas from `@specta/core`.
- `planningGraphSnapshotSchema` validates the temporary JSON graph snapshot
  format used before the SQLite TypeGraph backend is introduced.

TypeGraph reserves `id`, `kind`, and `meta`, so graph properties use
`fileKind` and `symbolKind` when the corresponding domain model uses `kind`.

The graph package owns ontology, graph validation, traversal and persistence
adapters. This initial version intentionally defines no database backend;
SQLite persistence is a deliverable of Epic 005, while Epic 010 owns graph
caching and performance.
