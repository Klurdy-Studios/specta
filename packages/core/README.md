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
