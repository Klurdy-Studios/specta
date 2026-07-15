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
                 Agent Integration
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

Agent Integrations translate native coding-agent commands into Specta workflows.
They provide the user experience; the Workflow Engine owns orchestration and the
Workspace Graph remains the source of truth.

---

# Core Components

## Agent Integrations

Agent Integrations are lightweight adapters that expose Specta workflows through
the native interaction model of a coding agent. They provide a dedicated,
familiar experience for Codex, Claude Code, Cursor, GitHub Copilot, VS Code,
JetBrains and future agents.

An integration is responsible only for user experience:

- registering native workflow commands
- presenting workflow progress and results
- translating native command input into a workflow request
- adapting rendered prompts and execution events to the host agent

Integrations contain minimal business logic. They must not compile graphs,
construct context, validate results or duplicate workflow policy.

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

The standalone CLI remains a portable workflow entry point. Agent Integrations
are the primary user-facing experience when a developer is working inside a
supported coding agent.

---

## MCP Server

MCP exposes reusable Specta capabilities to coding agents and integrations. It is
not the primary workflow interface and does not determine when capabilities run.
The Workflow Engine makes that decision when it executes a workflow.

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

The Workflow Engine orchestrates development workflows for any compatible coding
agent. Specta is not itself a coding agent: the engine coordinates deterministic
project knowledge, prompts and validation around an external agent.

Responsibilities:

- select the appropriate workflow for a requested operation
- load and render prompt templates
- compile and update the Workspace Graph
- invoke the Planner, Context Engine, Validator and Scaffold Engine
- communicate with coding agents through Agent Adapters
- manage task lifecycle, execution metadata and completion status
- validate outcomes and attach resulting implementation metadata to the graph

The Workflow Engine must not depend on a specific coding agent, model provider or
integration surface.

---

## Prompt Templates

Prompt templates define the conversational workflow, not one-off prompts. A
template specifies workflow stages, required graph context, agent inputs,
expected outputs and validation gates.

Initial template families include:

- plan
- design
- implement
- review
- validate
- scaffold

Templates are agent-agnostic. Before an Agent Adapter invokes a coding agent, the
Workflow Engine injects project context, relevant specifications, optimized
workspace context and workflow instructions. Agent Adapters translate the
rendered request into each agent's native protocol.

---

## Workflow Commands

Specta exposes workflow commands rather than low-level tools:

- `specta-plan`
- `specta-design`
- `specta-scaffold`
- `specta-implement`
- `specta-review`
- `specta-validate`
- `specta-context`

The workflow remains identical across agents while the command feels native:
Codex may expose custom commands, Claude Code may expose slash commands, and VS
Code may expose Command Palette actions. Future agents can present the same
workflow through their own native interaction model.

---

## Agent Adapters

Agent Adapters isolate the Workflow Engine from coding-agent-specific protocols.
Each Agent Integration implements an Agent Adapter without changing workflow
orchestration.

An adapter is responsible for:

- executing prompts or workflow requests
- streaming responses and execution events
- applying or reporting edits according to the integration's capabilities
- collecting execution metadata
- reporting completion, failure and cancellation

Conceptually:

```ts
interface AgentAdapter {
  execute(request: AgentExecutionRequest): AsyncIterable<AgentEvent>
  applyEdits?(edits: ProposedEdit[]): Promise<EditApplicationResult>
  collectMetadata(executionId: string): Promise<AgentExecutionMetadata>
}
```

The Workflow Engine depends only on this contract. Adapters are integration
plugins, not part of the deterministic core.

---

## Workflow Examples

### Implement a task

User executes:

```
specta implement authentication
```

The Workflow Engine compiles the workspace, updates the graph, resolves the task,
compiles optimized context, invokes the coding agent, validates the implementation
and updates the graph with the outcome.

### Review a pull request

User executes:

```
specta review pull-request
```

The Workflow Engine compiles the workspace, loads affected stories, gathers
related architecture, invokes the coding agent and validates review findings.
These are workflow stages, not implementation instructions embedded in an
integration.

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
the compiled context to an Agent Adapter when an external coding agent is needed.

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
    integrations/
        codex/
        claude/
        cursor/
        vscode/
        shared/
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
- Prompt-template loading and rendering
- Task lifecycle management
- Agent Adapter contracts and adapter registration
- Coordination of graph compilation, context generation and validation

---

### integrations

- Isolated Agent Integrations for native agent user experiences
- Agent Adapter implementations
- Agent-specific command registration and response presentation
- Shared portable prompt templates and workflow utilities

Integrations must delegate workflow execution to `workflow` and must not contain
domain or orchestration logic.

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

Exposes reusable Specta capabilities to coding agents and integrations.

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
- Agent Adapters
- Agent Integrations

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
- Compatibility with any coding agent through Agent Adapters and reusable MCP capabilities
- Support single repositories and monorepos using the same architecture.

# Design Principles

- Every repository is a Workspace.
- Every Workspace contains one or more Projects.
- Every Project is represented as a graph.
- Planning artifacts and implementation artifacts coexist in the same graph.
- Context compilation is performed at the Project level while respecting Workspace-level architecture, dependencies, and coding standards.
- The Workspace Graph is the single source of truth for all planning, implementation, validation, and context generation.
- The Workflow Engine coordinates workflows; coding agents perform agent-specific execution through adapters.
- Specta Core is completely agent-agnostic.
- Every coding agent is supported through an Agent Integration.
- Agent Integrations provide the native user experience.
- Workflow orchestration belongs exclusively to the Workflow Engine.
- Business logic must never be duplicated inside integrations.
- Prompt Templates are portable across integrations.
