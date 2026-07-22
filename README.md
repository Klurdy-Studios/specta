# Specta

> Give coding agents the smallest sufficient context, a declared implementation boundary, and proof that the work matches the plan.

Specta is a graph-backed software-engineering workflow for Codex and other coding agents. It turns a product brief and an existing repository into a **Workspace Graph**: a durable map of planning decisions, architecture, Epics, technical designs, code symbols, tests, dependencies, and validation evidence.

Instead of repeatedly asking an agent to rediscover a codebase, Specta selects the relevant graph neighborhood for one Epic, fits optional context to a token budget, and preserves the result as an immutable run packet. Agents receive a precise task and contract; Specta retains the traceability.

## Why Specta

Coding agents are powerful, but repository-scale work often fails for predictable reasons:

- Too much context wastes tokens and obscures the task.
- Too little context loses requirements, dependencies, and established contracts.
- A plan can drift from generated code with no reliable way to prove it.
- Parallel or interrupted work can lose its state.

Specta makes the Workspace Graph the source of truth, then uses deterministic selection and validation around the agent.

| Capability | What it gives a team |
| --- | --- |
| Token-bounded context | A ranked, compact context packet with an explicit `--max-tokens` budget. Required requirements and contracts are retained; optional source and dependency context is trimmed deterministically. |
| Scaffold as a control net | Technical Design declarations define the allowed files, exports, and public signatures before implementation. The agent can add behavior, but must preserve the approved shape. |
| Durable workflow state | Design, scaffold, implementation run, context packet, validation report, and graph links persist in SQLite so interrupted agent work resumes safely. |
| Evidence-based completion | Specta connects acceptance criteria to real tests, re-analyzes source, runs project checks, and records file/symbol `IMPLEMENTS` and test `VALIDATES` relationships. |
| Existing-project awareness | It detects project/framework evidence and associates a separate Project Profile with an existing Project without conflating their graph identities. |

## The control-net workflow

Scaffolding is Specta’s control net for a coding agent. It is not a code generator that pretends the implementation is complete.

1. **Plan** — turn a brief into Vision, Constitution, Architecture, Roadmap, and Epics.
2. **Design** — declare the Epic’s modules, files, exports, signatures, ownership, dependencies, and architecture mapping.
3. **Approve** — validate language and dependency contracts before source changes.
4. **Scaffold** — prepare declaration-only boundaries. The coding agent creates those declarations; Specta finalizes them only when they match the approved design.
5. **Implement** — give Codex a frozen, token-bounded Context Packet for the one eligible Epic.
6. **Validate and finalize** — recompile analysis, run tests/lint/type checks, verify acceptance evidence and signatures, then atomically mark the Epic complete or leave it ready for fixes.

```text
Brief → Planning Graph → Technical Design → Approved Scaffold
                                           ↓
                                Codex implementation run
                                           ↓
                  Context budget + source analysis + test evidence
                                           ↓
                         Validation Report + graph provenance
```

This boundary matters: Specta lets an agent choose implementation details while preventing accidental API, file-ownership, or requirement drift.

## Use Specta with Codex

Specta is currently run from a local checkout; it is not yet published to npm or installed globally. From the Specta repository:

```bash
pnpm install
node /absolute/path/to/specta/apps/cli/bin/specta.mjs \
  init /absolute/path/to/your/project --skill-target codex
```

Then work from the target project and invoke the CLI from that checkout:

```bash
cd /absolute/path/to/your/project
node /absolute/path/to/specta/apps/cli/bin/specta.mjs compile
```

Initialization creates `.specta/`, a SQLite-backed Workspace Graph, workflow prompts, and native Codex Skills such as `specta-design`, `specta-scaffold`, `specta-implement`, and `specta-validate`.

In Codex, work through the generated Skill for the current stage. It gives the agent the relevant prompt and requires it to return a reviewable JSON draft or implementation evidence rather than silently changing planning state.

A typical agent handoff looks like this:

```bash
# Create a design from a reviewed draft.
node /absolute/path/to/specta/apps/cli/bin/specta.mjs \
  design <epic-id> --draft .specta/drafts/design.json
node /absolute/path/to/specta/apps/cli/bin/specta.mjs \
  approve-design <design-id>

# Lock the public shape before implementation.
node /absolute/path/to/specta/apps/cli/bin/specta.mjs \
  scaffold <design-id> --prepare
# Codex creates the prepared declaration-only files.
node /absolute/path/to/specta/apps/cli/bin/specta.mjs \
  scaffold <design-id> --finalize <scaffold-run-id>

# Give Codex the next eligible Epic and a bounded context packet.
node /absolute/path/to/specta/apps/cli/bin/specta.mjs \
  implement next --prepare --max-tokens 8000 --json
# Codex implements the Epic and writes criterion-to-test evidence.
node /absolute/path/to/specta/apps/cli/bin/specta.mjs \
  implement <implementation-run-id> --finalize \
  --evidence .specta/implementation-evidence.json --json
```

The implementation run records both the deterministic context estimate and coding-agent token telemetry when the host provides it. If telemetry is unavailable, Specta states that explicitly instead of inventing numbers.

## CLI quick reference

Run commands from an initialized workspace. In the table, `specta` is readable shorthand for:

```bash
node /absolute/path/to/specta/apps/cli/bin/specta.mjs
```

The `.mjs` runner owns the current source-runtime setup. Specta is not a global command or npm package yet. Replace identifiers with graph IDs emitted by previous commands.

| Command | Purpose |
| --- | --- |
| `specta init [path] --skill-target codex` | Initialize a workspace, detect projects, and generate Codex workflow Skills. |
| `specta plan foundation <brief> --draft <file>` | Persist Vision and Constitution from a reviewed draft. |
| `specta plan architecture --draft <file>` | Persist architecture after Foundation. |
| `specta plan roadmap --draft <file>` | Persist roadmap after Architecture. |
| `specta plan epics --draft <file>` | Persist Epics, Stories, acceptance criteria, and tasks. |
| `specta compile` | Analyze specifications and source files into the Workspace Graph. |
| `specta context <epic-id> --max-tokens <n> [--json]` | Inspect the selected implementation context before coding. |
| `specta design <epic-id> --draft <file>` | Create an immutable Technical Design revision. |
| `specta approve-design <design-id>` | Approve the latest language- and dependency-valid design. |
| `specta scaffold <design-id> --prepare` | Record expected declaration-only files and preservation hashes. |
| `specta scaffold <design-id> --finalize <scaffold-run-id>` | Validate agent-created scaffold files and mark the design scaffolded. |
| `specta validate <epic-id> --evidence <file> [--json]` | Run standalone structural, test, lint, and requirement validation. |
| `specta implement <epic-id\|next> --prepare [--max-tokens <n>]` | Start or resume the one eligible implementation run. |
| `specta implement <run-id> --finalize --evidence <file>` | Authoritatively validate and atomically complete or fail the Epic. |

## How it compares

These tools address adjacent parts of agentic engineering. Specta’s emphasis is a durable graph and contract-driven, token-bounded implementation loop.

| | Specta | SpectaKit | CodeGraph |
| --- | --- | --- | --- |
| Primary job | Plan-to-implementation control plane | Agent tooling and workflow primitives | Repository structure and dependency understanding |
| Source of truth | SQLite Workspace Graph spanning plan, code, tests, and workflow state | Varies by the configured workflow | Code graph / source analysis |
| Token strategy | Explicit context budgets with deterministic ranking and required-context guarantees | Prompt/tooling oriented | Retrieval and graph exploration oriented |
| Guardrail before coding | Approved declaration-only scaffold acts as a control net | Depends on the workflow | Typically analyzes existing code rather than defining an implementation boundary |
| Completion proof | Acceptance evidence, executable checks, signatures, and graph provenance | Depends on configured checks | Code/dependency insight rather than a full Epic completion protocol |
| Best fit | Teams using Codex to ship planned changes safely across a real codebase | Teams assembling flexible agent workflows | Teams exploring and understanding a codebase |

## Built for a hackathon, designed for real work

Specta’s MVP is intentionally narrow: TypeScript-first analysis, deterministic graph operations, SQLite persistence, and a Codex-native workflow. The core bet is simple:

**Better agent outcomes come from better boundaries, not bigger prompts.**

The project demonstrates that an agent can work quickly without operating blindly: give it the exact requirements, interfaces, dependencies, and budget it needs—then preserve evidence of what it changed and why.

## Repository layout

- `apps/cli` — the `specta` command-line interface.
- `packages/core` — canonical schemas, workspace configuration, and workflow contracts.
- `packages/graph` — Workspace Graph, SQLite persistence, analysis, context selection, and provenance.
- `packages/planner` — deterministic planning workflows and artifacts.
- `packages/implementation` — design, scaffold, implementation coordination, and validation.
- `examples/help-dock` and `examples/mtaa-events` — end-to-end workflow examples.

## Development

```bash
pnpm check
pnpm test
```

See the package READMEs for public APIs and implementation details.
