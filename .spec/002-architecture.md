# Specta Architecture

Version: 0.1 (Hackathon MVP)

---

# Overview

Specta is AI development infrastructure that sits between software projects and coding agents.

Rather than sending arbitrary repository text to an LLM, Specta constructs a structured knowledge graph representing the project and compiles the smallest possible context required to complete a task.

Specta is **not** a coding agent.

It improves any coding agent by supplying structured context, specifications, architectural knowledge, validation and project understanding.

Specta supports:

- New projects with no existing source code.
- Existing repositories.
- Monorepos.
- Multi-project workspaces.

Every repository is modeled as a Workspace.

A traditional repository is simply a workspace containing a single project, while a monorepo contains multiple related projects.

The same architecture powers every workflow.

---

# Design Goals

- Reduce prompt size
- Improve implementation quality
- Improve determinism
- Reduce unrelated code changes
- Remain model agnostic
- Remain language agnostic
- Work with any coding agent
- Support projects throughout their entire lifecycle

---

# Software Lifecycle

Unlike traditional code analysis tools, Specta begins before code exists.

Projects naturally evolve through multiple stages.

```
Idea
    ↓
Vision
    ↓
Specification
    ↓
Architecture
    ↓
Implementation
    ↓
Testing
    ↓
Maintenance
```

Specta maintains a single Project Graph throughout this lifecycle.

Initially the graph contains planning artifacts.

As implementation progresses, code is attached to existing graph nodes instead of creating a separate model.

---

# High Level Architecture

```
                     Developer
                         │
                         ▼
               Native Agent Surface
       ┌───────────┬───────────┬───────────┬───────────┐
       ▼           ▼           ▼           ▼           ▼
  Codex Skill  Claude Skill  Cursor Cmd  VS Code Cmd  Future Surfaces
                         │
                         ▼
                  Workflow Engine
                         │
                         ▼
                  Workspace Graph
       ┌─────────────────┼─────────────────┐
       ▼                 ▼                 ▼
    Planner        Context Engine   Validation Engine
       │                 │                 │
       └─────────────────┼─────────────────┘
                         ▼
               Scaffold Engine / Parsers
                         │
                         ▼
                    Repository
```

Native Agent Surfaces translate each agent's native interaction model into
Workflow Definitions. Their available behavior depends on the capabilities of
the host agent. The Workflow Engine owns execution and the Workspace Graph
remains the source of truth.

---

# Core Components

## Native Agent Surfaces

Native Agent Surfaces make Specta feel familiar inside Codex, Claude Code,
Cursor, GitHub Copilot, VS Code, JetBrains and future agents. They present
generated Skills or commands in the form each agent supports.

They provide user experience only. They must not compile graphs, construct
context, validate results or duplicate workflow policy.

---

## Workflow Definitions

Workflow Definitions are platform-independent descriptions of development
workflows. They are the canonical representation of user-facing workflows.

Initial definitions include:

- plan
- design
- scaffold
- implement
- review
- validate
- context

Each definition declares its name, description, supported parameters, execution
steps, prerequisites, outputs, prompt-template reference, artifact-template
reference, completion criteria and validation requirements. Every user-facing
command or Skill is generated from a Workflow Definition.

## Progressive Planning

Planning is a sequence of small, graph-backed workflows rather than one large
generation request:

```text
Brief → Foundation (Vision + Constitution) → Architecture → Roadmap → Epics (Stories + Tasks)
```

Each stage compiles the validated artifacts from earlier stages as its input,
then persists only its own output and incrementally updates the Workspace Graph.
Upstream artifacts remain stable while later stages run.

---

## Workflow Manifest

Workflow Definitions are stored in a single manifest format. The manifest is the
source of truth for generating consistent Skills across supported agent surfaces.
It describes what a workflow does without embedding agent-specific business
logic.

---

## Skills

Skills are packaging formats for coding agents, generated deterministically from
Workflow Definitions. Examples include Codex Skills, Claude Skills, Cursor
Commands and future agent packages.

Skills contain only workflow metadata, workflow descriptions, prompt-template
references, helper scripts and references. They contain no business logic;
business logic remains inside Specta Core.

---

## CLI

Responsible for:

- command parsing
- configuration
- workspace discovery
- invoking workflows

Commands include:

```
specta init
specta plan
specta implement
specta scaffold
specta compile
specta context
specta validate
specta import
specta explain
specta mcp
```

Commands execute named workflows rather than calling domain services directly. For
example, `specta implement` coordinates graph compilation, context generation,
an agent interaction, validation and graph updates through the Workflow Engine.

The CLI should contain almost no business logic.

Generated Skills and native commands are the primary user-facing workflow
surface. The CLI is an execution helper that a Skill may invoke to run the
Workflow Engine; it is also useful for automation and diagnostics.

---

## MCP Server

MCP is a platform API that exposes reusable Specta capabilities. It is not the
primary workflow interface and does not determine when capabilities run. The
Workflow Engine makes that decision when it executes a workflow.

Examples:

- compile()
- context()
- validate()
- graph()
- search()

These are low-level platform capabilities. Users should rarely invoke them
directly; workflow commands orchestrate them automatically.

---

## Workflow Engine

The Workflow Engine orchestrates Workflow Definitions for any compatible coding
agent. Specta is not itself a coding agent: the engine coordinates deterministic
project knowledge, prompts and validation around native agent surfaces.

Responsibilities:

- load Workflow Definitions
- compile and update the Workspace Graph
- generate optimized context
- invoke Specta services
- coordinate validation
- expose execution state
- communicate with coding agents through native Skills

The Workflow Engine must not depend on a specific coding agent, model provider or
integration surface.

---

## Prompt Templates

Prompt Templates are reusable, platform-independent conversational templates
used by Workflow Definitions. They do not contain business logic.

Prompt and artifact templates are Markdown files. The Workflow Manifest remains
the canonical structured definition; `prompts/*.md` describes the conversation,
and `artifacts/*.md` controls the layout of generated documentation.

Initial template families include:

- plan
- design
- implement
- review
- validate
- scaffold

Before a Skill invokes a coding agent, the Workflow Engine injects project
context, relevant specifications, optimized workspace context and workflow
instructions. Skills reference Prompt Templates without changing them.

---

## Workflow Commands

Specta CLI commands execute Workflow Definitions rather than low-level tools:

- `specta-plan`
- `specta-design`
- `specta-scaffold`
- `specta-implement`
- `specta-review`
- `specta-validate`
- `specta-context`

Planning also exposes stage commands:

- `specta-plan-foundation`
- `specta-plan-architecture`
- `specta-plan-roadmap`
- `specta-plan-epics`

`specta-plan` selects the next eligible stage. Native Skills and commands expose
the same definitions using the conventions available on their host agent.

The same definition can generate a Codex Skill, Claude Skill, Cursor Command or
VS Code Command. Each native surface presents it according to its capabilities.

---

## Skill Generation

Skill Generation produces platform-specific Skills from Workflow Definitions.
Generation is deterministic: the same definition produces the same Skill package
for a given native agent surface.

The generated output may be a Codex Skill, Claude Skill, Cursor Command or a
future agent package. The output packages behavior for an agent; it never moves
business logic out of Specta Core.

---

## Workflow Examples

### Implement a task

User executes:

```
specta implement authentication
```

The Workflow Engine compiles the workspace, updates the graph, resolves the task,
compiles optimized context, invokes the native Skill, validates the implementation
and updates the graph with the outcome.

### Review a pull request

User executes:

```
specta review pull-request
```

The Workflow Engine compiles the workspace, loads affected stories, gathers
related architecture, invokes the native Skill and validates review findings.
These are workflow stages, not implementation instructions embedded in a Skill.

---

## Planner

Uses an LLM to create project documentation.

Responsible for generating:

- Vision
- Constitution
- Architecture
- Roadmap
- Epics
- Stories
- Acceptance Criteria
- Tasks
- Planned Modules
- Planned Services
- Planned APIs

Planner creates project intent.

It does not implement application code.

---

## Scaffold Engine

Creates the initial project structure from planned artifacts.

Example:

```
Vision
    ↓
Architecture
    ↓
Stories
    ↓
Planned Modules
    ↓
specta scaffold
    ↓
src/
controllers/
services/
repositories/
tests/
```

Scaffolding creates project structure only.

Business logic remains the responsibility of coding agents.

---

## Import Engine

Allows importing existing planning systems.

Supported sources may include:

- Spec Kit
- Markdown
- GitHub Issues
- Jira
- Linear

All imported information is transformed into Specta's canonical data model.

---

## Specification Parser

Reads markdown specifications.

Extracts:

- requirements
- epics
- stories
- tasks
- acceptance criteria
- architecture decisions

Outputs Project Graph nodes.

---

## Code Parser

Responsible for static analysis.

MVP supports:

- TypeScript

Future versions:

- Python
- Go
- Rust
- Java

Responsibilities:

- imports
- exports
- classes
- interfaces
- functions
- tests
- symbols

The parser enriches the Project Graph with implementation details.

---

# Workspace

Workspace is the root entity in Specta.

Every repository is represented as a Workspace regardless of size.

Single repository

Workspace

↓

Project

Monorepo

Workspace

↓

Project A

Project B

Project C

Shared Packages

Workspace-level artifacts include:

- Constitution
- Architecture
- Global Rules
- Shared Packages
- Shared Dependencies

Projects inherit workspace configuration while maintaining their own planning and implementation artifacts.

---

# Workspace Graph

The Workspace Graph is Specta's source of truth.

Unlike traditional dependency graphs, Specta models both **intent** and **implementation**.

Everything becomes graph nodes.

```
Workspace
    ↓
Epic
    ↓
Story
    ↓
Requirement
    ↓
Acceptance Criteria
    ↓
Task
    ↓
Module
    ↓
Interface
    ↓
Function
    ↓
File
    ↓
Code Symbol
    ↓
Test
```

Planning artifacts and implementation artifacts coexist in the same graph.

Relationships include:

- IMPLEMENTS
- DEPENDS_ON
- TESTS
- OWNS
- USES
- REFERENCES
- IMPORTS
- EXPORTS

---

# Planned vs Implemented Artifacts

Projects often begin before any source code exists.

Specta therefore distinguishes between planned and implemented artifacts.

Example:

```
Story
    ↓
Module (planned)
    ↓
Interface (planned)
    ↓
Function (planned)
```

After implementation:

```
Story
    ↓
Module
    ↓
Interface
    ↓
Function
    ↓
Source File
    ↓
Tests
```

The same graph nodes evolve throughout the project lifecycle.

---

# Node Lifecycle

Every graph node progresses through a lifecycle.

```
Proposed
    ↓
Planned
    ↓
Implemented
    ↓
Tested
    ↓
Deprecated
    ↓
Removed
```

This allows Specta to understand both unfinished and completed work.

---

# Context Engine

The Context Engine is the heart of Specta.

Input:

```
Implement JWT Authentication
```

Output:

- Relevant specifications
- Relevant architecture
- Relevant files
- Relevant symbols
- Relevant tests
- Relevant dependencies
- Coding constraints
- Token estimate

If code does not yet exist, the Context Engine compiles context from planning artifacts alone.

If code exists, implementation details are merged into the compiled context.

The Context Engine always returns the smallest sufficient context.

The Workflow Engine invokes the Context Engine as a workflow stage and supplies
the compiled context to a native Skill when an external coding agent is needed.

---

# Context Compilation Pipeline

```
Task
    ↓
Locate Story
    ↓
Locate Requirements
    ↓
Acceptance Criteria
    ↓
Architecture Rules
    ↓
Relevant Workspace
    ↓
Relevant Project
    ↓
Relevant Stories
    ↓
Relevant Files
    ↓
Shared Packages
    ↓
Relevant Symbols
    ↓
Relevant Tests
    ↓
Dependency Expansion
    ↓
Duplicate Removal
    ↓
Token Optimization
    ↓
Compiled Context
```

---

# Validator

Responsible for ensuring generated code satisfies project specifications.

Validation occurs against:

- Requirements
- Acceptance Criteria
- Architecture Rules
- Coding Standards
- Tests

Future versions may validate semantic correctness using an LLM.

The Workflow Engine invokes validation before completion and records the result in
the Workspace Graph so later workflows can reason about the outcome.

---

# Graph Queries

The graph should support queries such as:

- Which project owns this file?
- Which workspace rules apply?
- Which shared package provides this interface?
- Which projects depend on this service?
- Which requirements remain unimplemented?
- Which stories affect this package?
- Which architecture decision introduced this dependency?
- Which planned modules are still missing?
- Which implemented files have no specification?

---

# Directory Structure

```
packages/
    core/
    graph/
    planner/
    scaffold/
    parser-markdown/
    parser-typescript/
    context/
    workspace/
    workflow/
    skills/
    validator/
    cli/
    mcp/
    shared/

apps/
    cli/
    mcp/

docs/

examples/
```

---

# Core Package Responsibilities

### core

- Domain models
- Interfaces
- IDs
- Errors
- Events

No OpenAI dependency.

---

### graph

- Graph storage
- Traversal
- Impact analysis
- Queries
- Serialization

---

### planner

- LLM integration
- Specification generation
- Specification updates

---

### scaffold

- Generate project structure
- Create folders
- Create placeholder modules
- Generate implementation skeletons

---

### parser-markdown

Reads project specifications and produces graph nodes.

---

### parser-typescript

Reads source code and produces graph nodes.

---

### context

- Graph traversal
- Context ranking
- Token optimization
- Prompt generation

---

### workflow

- Workflow orchestration and execution
- Workflow Definition loading
- Prompt-template loading and rendering
- Task lifecycle management
- Coordination of graph compilation, context generation and validation

---

### skills

- Deterministic Skill generation from Workflow Definitions
- Codex Skills, Claude Skills, Cursor Commands and future agent packages
- Portable Skill metadata, prompt-template references and helper scripts

Skills must delegate workflow execution to `workflow` and must not contain domain
or orchestration logic.

---

### validator

- Requirement validation
- Architecture validation
- Acceptance criteria validation

---

### cli

Thin interface around Workflow Engine entry points.

---

### mcp

Exposes reusable platform capabilities.

---

# Canonical Data Model

- Workspace
- Project
- Vision
- Constitution
- Architecture
- Epic
- Story
- Requirement
- AcceptanceCriteria
- Task
- ArchitectureDecision
- Module
- Interface
- Function
- File
- CodeSymbol
- Test
- Dependency

Every subsystem operates on these entities.

---

# Plugin Architecture

Future extensions should be implemented as plugins.

Examples:

- Language Parsers
- Validators
- Planning Providers
- LLM Providers
- Importers
- Scaffold Templates
- Prompt Templates
- Workflow Definitions
- Skills

The core architecture should remain unchanged as new capabilities are added.

---

# Non Goals (Hackathon MVP)

- VSCode extension
- SaaS platform
- Authentication
- Cloud sync
- Billing
- Team collaboration
- Web dashboard

Focus entirely on developer workflows.

---

# Success Metrics

- Context size reduced by 70%+
- Fewer unrelated file edits
- Higher implementation accuracy
- Deterministic project understanding
- Support for both greenfield and existing repositories
- Compatibility with any coding agent through generated Skills and reusable MCP capabilities
- Support single repositories and monorepos using the same architecture.

# Design Principles

- Every repository is a Workspace.
- Every Workspace contains one or more Projects.
- Every Project is represented as a graph.
- Planning artifacts and implementation artifacts coexist in the same graph.
- Context compilation is performed at the Project level while respecting Workspace-level architecture, dependencies, and coding standards.
- The Workspace Graph is the single source of truth for all planning, implementation, validation, and context generation.
- The Workflow Engine executes Workflow Definitions.
- Specta Core is completely agent-agnostic.
- Every coding agent is supported through a native Skill or command surface.
- Native Agent Surfaces provide the user experience.
- Workflow orchestration belongs exclusively to the Workflow Engine.
- Workflow Definitions are the canonical workflow representation.
- Skills are generated artifacts and contain no business logic.
- Business logic belongs exclusively to Specta Core.
- Prompt Templates are portable across native agent surfaces.
- Workflow execution must be deterministic whenever possible.
- Specta should feel native inside every supported coding agent.


# Core Tech Use

- Parser: tree-sitter (lightning-fast AST extraction; discards function bodies to strip out garbage tokens)
- Graph Database: TypeGraph + SQLite (on-device, type-safe entity relations with Zod validation)
- File Watcher: chokidar (<10ms reactive file syncing and graph diff calculation)
- Visualizer: 3d-force-graph (Three.js WebGL engine; maps structural connections and ghost nodes in 3D)

TypeGraph owns the graph ontology and uses the canonical Zod entity schemas.
The ontology and validation layer may be introduced before a database adapter.
SQLite-backed persistence is delivered with the Workspace Graph in Epic 005;
Epic 010 adds caching and performance optimizations on top of that persisted graph.
