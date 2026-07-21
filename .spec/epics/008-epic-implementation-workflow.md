# Epic 008 — Epic Implementation Workflow

## Goal

Coordinate implementation of one eligible Epic at a time through the active
coding agent.

## Description

`specta implement` is an agent-oriented workflow entry point. It resolves an
explicit Epic or the next eligible Epic from the Workspace Graph, compiles the
smallest relevant context through the Context Engine, and prepares an
Implementation Run for the active coding agent.

The coding agent uses its own reasoning to modify source files. Specta does not
generate business logic itself. After the agent finishes, the workflow compiles
the workspace again, invokes the Validation Engine, and updates implementation
state in the Workspace Graph transactionally.

An Epic is complete only when its required Stories, acceptance criteria,
architecture constraints, tests, and dependency validations pass.

## Prerequisites

- Epic 005 — Workspace Graph
- Epic 006 — Context Engine
- Epic 007 — Validation Engine
- An approved Technical Design for the selected Epic
- Any required scaffold preparation is finalized

## User Stories

- Implement an explicitly selected Epic.
- Resolve and implement the next eligible Epic deterministically.
- Prevent implementation when prerequisite Epics or dependencies are incomplete.
- Prepare optimized Epic, Story, Task, architecture, dependency, and source context.
- Let the active coding agent reason about and write the implementation.
- Resume an interrupted Implementation Run without losing graph-backed state.
- Validate implementation automatically before marking an Epic complete.
- Record failed validation without incorrectly completing the Epic.
- Update planned-versus-implemented relationships after successful validation.

## Deliverables

- `specta implement <epic-id>`
- `specta implement next`
- Prepare/finalize CLI protocol for coding-agent workflows
- `specta-implement` Workflow Definition
- Implementation prompt template
- Native implementation Skill
- Implementation workflow coordinator in `@specta/implementation`
- Graph-backed Implementation Run and Epic implementation status

## Workflow

```text
Resolve eligible Epic
        ↓
Compile Workspace Graph
        ↓
Compile optimized implementation context
        ↓
Prepare graph-backed Implementation Run
        ↓
Coding agent reasons about and writes source code
        ↓
Recompile Workspace Graph
        ↓
Validate requirements, architecture, acceptance criteria and tests
        ↓
Finalize or retain actionable failure state
```

The CLI helper exposes explicit phases so a native Skill can safely surround
agent-authored file changes:

```text
specta implement <epic-id|next> --prepare
specta implement <implementation-run-id> --finalize
```

## Acceptance Criteria

- Exactly one Epic is selected per Implementation Run.
- `next` selects the earliest eligible incomplete Epic using graph relationships
  and roadmap order.
- An Epic cannot start before its approved Technical Design and graph
  prerequisites are available.
- Prepare returns a persisted run ID and optimized implementation packet.
- The packet contains the selected Epic, Stories, Tasks, acceptance criteria,
  architecture constraints, relevant dependencies, source files, and tests.
- Native Skills use the packet while the active coding agent authors source
  changes; the CLI contains no business-logic generation.
- Finalize recompiles the graph and invokes validation automatically.
- Failed validation persists actionable findings and leaves the Epic incomplete.
- Successful validation records implementation relationships and marks the Epic
  complete transactionally.
- Repeating prepare or finalize is deterministic and does not duplicate runs,
  nodes, relationships, or completion state.
- The next Epic becomes eligible only after required predecessor completion.

