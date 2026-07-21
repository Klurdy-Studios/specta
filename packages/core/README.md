# Core public API

`@specta/core` exposes canonical Zod schemas, inferred domain types, IDs and
errors. Supporting deterministic runtime modules are available through explicit
subpaths:

- `@specta/core/filesystem`
- `@specta/core/config`
- `@specta/core/workspace`
- `@specta/core/workflow`
- `@specta/core/skills`
- `@specta/core/validation`

The root entry point does not re-export Node adapters or concrete workflows.

`@specta/core/validation` exports the language-independent `ValidationCheck`,
`ValidationCommand`, `ValidationCommandResult`, `ValidationEvidence`, and
`ValidationReport` schemas and types. `ValidationCommandRunner` is the
injectable shell-free execution boundary used by validation engines. Test
commands carry the exact workspace-relative `testPaths` they are expected to
execute, and reports retain both their immutable Context Packet fingerprint and
their complete validation-input fingerprint.

The root also exports the canonical, language-independent analysis contracts:
`ParsedSpecification`, `ParsedSpecificationEntity`, `ParsedSourceFile`,
`ParsedImport`, `ParsedExport`, `ParsedCodeSymbol`, `ParsedTest`,
`ParseDiagnostic`, `SourceLocation`, and `WorkspaceAnalysis`, together with
their Zod schemas. Parsed imports may carry their resolved workspace file,
external package, or unresolved specifier so resolution is performed once and
reused by graph projection and later workflows.
