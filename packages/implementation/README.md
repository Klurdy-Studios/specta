# Implementation public API

The implementation package coordinates Epic-scoped Technical Designs,
declaration-only scaffolding performed by an external coding agent, and
deterministic validation of completed Epic work.

## Project profiles

- createProjectProfileResolver deterministically detects existing Next.js,
  React, Angular, NestJS, Express, or plain TypeScript projects.
- Frameworks are project metadata, not adapters.
- Blank-project framework and toolchain selections are explicit Technical
  Design inputs.

## Language adapters

- createLanguageAdapterRegistry resolves language adapters.
- typeScriptLanguageAdapter is the only built-in adapter in the MVP.
- It validates TypeScript and TSX exports and rejects executable bodies in new
  Epic-owned scaffold files.

## Workflows

- createTechnicalDesignWorkflow creates an immutable design revision.
- createTechnicalDesignApprovalWorkflow approves the latest language-valid,
  dependency-valid revision.
- createScaffoldWorkflow exposes prepare and finalize. Prepare records
  preservation hashes and optional framework bootstrap instructions; finalize
  validates agent-created declarations and updates the Workspace Graph.
- Blank-project preparation searches installed agent Skills for the selected
  framework and returns an explicit online npx skills find command. Discovery
  never installs or executes a Skill automatically.
- implementationWorkflowModule supplies the design, approve-design, scaffold,
  validate, and implement Workflow Definitions and maintained native Skill assets.

## Epic implementation workflow

- `createImplementationWorkflowCoordinator()` prepares or resumes exactly one
  eligible Epic and finalizes it after coding-agent edits.
- `prepare()` persists a deterministic Implementation Run and immutable,
  token-bounded Context Packet. Explicit and `next` selection both require a
  finalized scaffold and completed predecessor Epics.
- `finalize()` recompiles source analysis, evaluates full validation, derives
  planned-to-implemented relationships, and commits the report, run, Epic
  status, and relationships atomically.
- Finalization records coding-agent token telemetry when the host exposes it.
  Otherwise it completes normally and explicitly reports telemetry as
  unavailable. The rendered breakdown joins that observation with the Context
  Packet's authoritative estimate without duplicating it in Workflow Run state.
- `renderImplementationPreparation()` and `renderImplementationFinalization()`
  provide concise agent-readable output; JSON CLI output carries the complete
  packet and canonical result.

## Validation

- `createImplementationValidationEngine()` validates one Epic against its
  approved Technical Design, compiled files and symbols, required dependencies,
  architecture, acceptance-criterion evidence, blast radius, and executable
  project scripts. It persists a report but never changes implementation state.
- `ImplementationValidationRequest` accepts an Epic ID, optional Implementation
  Run ID, and explicit criterion-to-test `ValidationEvidence`. Evidence paths
  may be workspace-relative or relative to the Technical Design project. A
  run-scoped request reuses that run's immutable persisted Context Packet.
- `discoverValidationCommands()` deterministically discovers test,
  check/typecheck, and lint scripts for the target and impacted projects.
  `createValidationCommandRunner()` runs argument arrays without a shell and
  bounds time and captured output. Evidence files are executed through direct
  Vitest, Jest, or Node test-runner commands and must appear on a successful
  command result; impacted projects
  without local tests fall back to the nearest test-owning workspace project.
  Timeouts terminate the spawned process tree. A custom
  `ValidationCommandRunner` can be injected for another execution environment.
- `renderValidationReport()` renders the canonical report for a coding agent.
  Full mode is authoritative; structural mode always remains non-passing.
- Architecture components must explicitly match a Technical Design module name,
  path, or purpose. Each component is evaluated against only its mapped files
  and symbols plus required dependencies.
- Epic implementation orchestration consumes this engine in Epic 008 and
  commits successful or failed status atomically through graph workflow state.

## Storage

Technical Designs, project profiles, and scaffold runs are persisted through
repositories owned by the graph package. The implementation package contains
no independent storage format.
