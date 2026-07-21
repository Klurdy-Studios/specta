# Core public API

`@specta/core` exposes canonical Zod schemas, inferred domain types, IDs and
errors. Supporting deterministic runtime modules are available through explicit
subpaths:

- `@specta/core/filesystem`
- `@specta/core/config`
- `@specta/core/workspace`
- `@specta/core/workflow`
- `@specta/core/skills`

The root entry point does not re-export Node adapters or concrete workflows.

The root also exports the canonical, language-independent analysis contracts:
`ParsedSpecification`, `ParsedSpecificationEntity`, `ParsedSourceFile`,
`ParsedImport`, `ParsedExport`, `ParsedCodeSymbol`, `ParsedTest`,
`ParseDiagnostic`, `SourceLocation`, and `WorkspaceAnalysis`, together with
their Zod schemas. Parsed imports may carry their resolved workspace file,
external package, or unresolved specifier so resolution is performed once and
reused by graph projection and later workflows.
