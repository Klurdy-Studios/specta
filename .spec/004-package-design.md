# Specta Package Design

Status: Approved and implemented

## Decision

Specta uses four private engine packages and two public application packages.
Logical modules that do not need an independent release lifecycle are exposed
as subpaths instead of separate pnpm packages.

```text
packages/
  core/
  graph/
  planner/
  implementation/

apps/
  cli/
  mcp/
```

The package boundary represents an independently meaningful engine capability,
not every internal module. Filesystem access, configuration, workspace
management, workflow primitives, and Skill installation remain focused modules
inside `@specta/core`.

## Package dependency graph

```text
@specta/core
    ↑
    ├── @specta/graph
    │       ↑
    │       ├── @specta/planner
    │       └── @specta/implementation
    │
    ├── @specta/planner
    └── @specta/implementation

@specta/cli ──→ core + graph + planner + implementation
@specta/mcp ──→ core + graph + planner + implementation
```

Rules:

- `core` cannot import `graph`, `planner`, or `implementation`.
- `graph` depends only on `core` and graph-specific third-party libraries.
- `planner` and `implementation` may depend on `core` and `graph`.
- `planner` and `implementation` do not depend on each other. They communicate
  through canonical entities and the Workspace Graph.
- Applications are composition roots. They may import every engine package but
  contain no domain logic.
- Circular package dependencies are prohibited.

## `@specta/core`

`core` owns universal deterministic contracts and local runtime primitives. It
contains no planning, implementation, TypeGraph, CLI, MCP, or coding-agent
business logic.

### Public exports

```json
{
  "exports": {
    ".": "./src/domain/index.ts",
    "./filesystem": "./src/filesystem/index.ts",
    "./config": "./src/config/index.ts",
    "./workspace": "./src/workspace/index.ts",
    "./workflow": "./src/workflow/index.ts",
    "./skills": "./src/skills/index.ts"
  }
}
```

### Internal structure

```text
packages/core/
  src/
    domain/
      index.ts
    filesystem/
      index.ts
    config/
      index.ts
    workspace/
      discovery.ts
      repository.ts
      initialization.ts
      index.ts
    workflow/
      definition.ts
      registry.ts
      execution.ts
      index.ts
    skills/
      generator.ts
      installer.ts
      index.ts
```

### Responsibilities

- Canonical Zod entity schemas, inferred types, IDs, errors and shared results.
- Filesystem port and local Node filesystem adapter.
- Workspace configuration, repository discovery and workspace metadata.
- Generic Workflow Definition, registration and execution contracts.
- Deterministic generation and installation of native Skills from registered
  workflow assets.

The root export exposes only domain contracts. It must not re-export Node
filesystem adapters or other subpath modules.

The generic workflow engine executes registered handlers. It does not import
concrete planning or implementation workflows. Workspace initialization accepts
registered workflow modules from the application composition root, allowing it
to create the manifest and install Skills without importing `planner` or
`implementation`.

## `@specta/graph`

`graph` owns the Workspace Graph and its storage implementation.

```text
packages/graph/
  src/
    ontology/
    repository/
    queries/
    traversal/
    persistence/
    index.ts
```

Responsibilities:

- TypeGraph ontology using canonical Zod schemas from `core`.
- Typed nodes and relationships.
- Graph updates, traversal, queries and impact analysis.
- Serialization and SQLite persistence introduced in Epic 005.
- Graph caching added in Epic 011.

TypeGraph, Drizzle and SQLite dependencies remain isolated here. Planning and
implementation logic do not live in this package.

## `@specta/planner`

`planner` owns the complete progressive planning lifecycle.

```text
packages/planner/
  src/
    foundation/
    architecture/
    roadmap/
    epics/
    validation/
    workflows/
    index.ts
  templates/
    prompts/
    artifacts/
    skills/
```

Responsibilities:

- Foundation, Architecture, Roadmap and Epic planning.
- Stories, acceptance criteria and Tasks owned by Epics.
- Planning-stage validation and deterministic ID assignment.
- Planning artifact rendering.
- Planning graph updates through `@specta/graph` APIs.
- Planning Workflow Definitions, handlers and maintained assets.

The package exports a planning workflow module that applications register with
the core workflow engine. Workflow-specific prompt, artifact and Skill
templates live beside the package that owns their behavior.

## `@specta/implementation`

The package is named `implementation`, not `implementor`, because Specta
coordinates external coding agents rather than acting as a coding agent.

```text
packages/implementation/
  src/
    technical-design/
    scaffold/
    dependencies/
    validation/
    workflows/
    index.ts
  templates/
    prompts/
    artifacts/
    skills/
```

Responsibilities:

- Epic-scoped technical designs and revisions.
- Design approval.
- File and symbol dependency resolution.
- Declaration-only scaffolding.
- Implementation lifecycle and implementation-specific validation.
- Implementation Workflow Definitions, handlers and maintained assets.

Source-file creation remains the responsibility of the selected coding agent.
Specta validates declared files and records results in the Workspace Graph.

## Workflow module contract

Planner and implementation expose modules that can be registered without the
core package importing either package.

Conceptually:

```ts
interface WorkflowModule {
  definitions: WorkflowDefinition[]
  handlers: WorkflowHandler[]
  assets: WorkflowAssets[]
}
```

The CLI and MCP applications register available modules when they start:

```ts
const modules = [planningWorkflows, implementationWorkflows]
const engine = createWorkflowEngine({ modules, graph, workspace })
```

This inversion keeps the engine agent-agnostic, avoids package cycles, and lets
workspace initialization build its manifest and install native Skills from the
same registered definitions.

## Public npm packages

Only applications are published during the MVP:

### `@specta/cli`

```json
{
  "name": "@specta/cli",
  "bin": {
    "specta": "./dist/bin/specta.mjs"
  }
}
```

### `@specta/mcp`

```json
{
  "name": "@specta/mcp",
  "bin": {
    "specta-mcp": "./dist/bin/specta-mcp.mjs"
  }
}
```

The four engine packages remain private and are bundled into the published
applications. Their internal APIs can evolve without creating npm compatibility
obligations.

## Roadmap placement

New epic capabilities initially become modules in the package that owns the
relevant domain. Empty packages are not created in advance.

| Roadmap capability | Initial home |
| --- | --- |
| Workspace management | `core/workspace` |
| Planning | `planner` |
| Technical design and scaffolding | `implementation` |
| Markdown and TypeScript ingestion | `graph/parser` |
| Workspace Graph persistence and queries | `graph` |
| Context compilation and ranking | `graph/context` |
| Generic validation contracts | `core` |
| Planning validation | `planner/validation` |
| Implementation validation | `implementation/validation` |
| Import and export | `graph/exchange` |
| Native Skills | workflow assets in owning package; engine in `core/skills` |
| MCP capability surface | `apps/mcp` |
| Graph cache | `graph/persistence` |
| CLI output, progress and diagnostics | `apps/cli` |

## Possible future packages

A physical package is added only when at least one of these conditions applies:

- It is installed independently.
- It has an independent public API and release lifecycle.
- It carries large optional or native dependencies that most users do not need.
- It is an extension boundary for third parties.

Expected candidates, but not MVP requirements:

- `@specta/plugin-sdk` in v0.4 when third-party plugins are supported.
- Optional language parser plugins such as `@specta/parser-python` in v0.3 or
  v0.4 when they become independently installable.
- `@specta/sdk` if v1.0 exposes a hosted Graph API to external applications.

No package is created solely because an Epic or architectural component has a
name.

## Migration from the current layout

| Current package | Destination |
| --- | --- |
| `@specta/core` | `@specta/core` domain module |
| `@specta/filesystem` | `@specta/core/filesystem` |
| `@specta/config` | `@specta/core/config` |
| `@specta/workspace` | `@specta/core/workspace` |
| `@specta/skills` | `@specta/core/skills`; workflow-owned templates move to their owning package |
| `@specta/workflow` generic engine | `@specta/core/workflow` |
| `@specta/workflow` planning orchestration | `@specta/planner` |
| `@specta/workflow` technical design and scaffold | `@specta/implementation` |
| `@specta/planner` | `@specta/planner` |
| `@specta/graph` | `@specta/graph` |

The migration should preserve behavior and tests. It should first move modules
and update imports, then remove obsolete package manifests, and finally update
the architecture document to describe these package boundaries.

## Non-goals

- Publishing internal engine packages during the MVP.
- Creating one package for every Epic.
- Designing the complete v0.4 plugin system now.
- Introducing dependency-injection frameworks or an application container.
- Creating empty parser, context, validator or SDK packages before their
  functionality exists.
