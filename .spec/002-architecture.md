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
                 Specta CLI / MCP
                         │
                         ▼
                 Command Dispatcher
                         │
       ┌─────────────────┼─────────────────┐
       ▼                 ▼                 ▼
    Planner        Context Engine      Validator
       │                 │                 │
       └─────────────────┼─────────────────┘
                         ▼
                  Workspace Graph
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
  Spec Parser      Code Parser      Git Parser
                         │
                         ▼
                    Repository
```

---

# Core Components

## CLI

Responsible for:

- command parsing
- configuration
- workspace discovery
- invoking services

Commands include:

```
specta init
specta plan
specta scaffold
specta compile
specta context
specta validate
specta import
specta explain
specta mcp
```

The CLI should contain almost no business logic.

---

## MCP Server

Provides tools for coding agents.

Examples:

- context()
- impact()
- search()
- requirements()
- validate()
- architecture()
- tasks()

Coding agents should consume structured project knowledge rather than raw repository text whenever possible.

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

### validator

- Requirement validation
- Architecture validation
- Acceptance criteria validation

---

### cli

Thin interface around Specta services.

---

### mcp

Exposes Specta functionality to coding agents.

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
- Compatibility with any coding agent through MCP
- Support single repositories and monorepos using the same architecture.

# Design Principles

- Every repository is a Workspace.
- Every Workspace contains one or more Projects.
- Every Project is represented as a graph.
- Planning artifacts and implementation artifacts coexist in the same graph.
- Context compilation is performed at the Project level while respecting Workspace-level architecture, dependencies, and coding standards.
- The Workspace Graph is the single source of truth for all planning, implementation, validation, and context generation.