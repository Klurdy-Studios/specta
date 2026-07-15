# Specta Roadmap

Version: 0.1 (Hackathon MVP)

---

# Vision

Specta aims to become the development infrastructure layer for AI-assisted software engineering.

Rather than acting as another coding agent, Specta enables any coding agent to better understand software projects by transforming specifications and source code into a structured Workspace Graph and compiling optimized development context.

The roadmap is organized around progressively improving planning, workflow
orchestration, implementation, context compilation, and validation.

---

# Product Evolution

```
Planning
      ↓
Workspace Graph
      ↓
Workflow Engine
      ↓
Context Engine
      ↓
Validation
      ↓
Developer Platform
```

Each release expands Specta while keeping the Workspace Graph as the single source of truth.

---

# v0.1 — Hackathon MVP

## Goal

Demonstrate that structured project knowledge produces higher-quality AI coding results while reducing token usage.

## Features

### Workspace

- Initialize new workspaces
- Support existing repositories
- Support monorepos
- Workspace configuration

### Planning

- Generate Vision
- Generate Constitution
- Generate Architecture
- Generate Roadmap
- Generate Epics
- Generate Stories
- Generate Tasks

### Workflow Orchestration

- Select and execute development workflows
- Load agent-agnostic prompt templates
- Coordinate graph compilation, context generation and validation
- Define the Agent Adapter contract

Initial workflows include plan, scaffold and validate. They coordinate services;
they do not make Specta a coding agent.

### Agent Integrations

- Define native workflow commands for supported coding agents
- Keep the Workflow Engine and Core agent-agnostic
- Provide shared portable prompt templates and workflow utilities

### Scaffolding

Generate initial project structure from planned modules.

Example:

```
Stories
    ↓
Modules
    ↓
specta scaffold
    ↓
Project Structure
```

### Parsing

- Markdown parser
- TypeScript parser

### Workspace Graph

- Build Workspace Graph
- Parse project specifications
- Parse source code
- Link planning and implementation
- Persist compiled graph

### Context Engine

- Compile optimized context
- Dependency traversal
- Token optimization
- Prompt generation

### Validation

- Requirement validation
- Acceptance Criteria validation
- Architecture validation

### MCP

Expose reusable Specta capabilities through the Model Context Protocol. MCP is a
capability surface, while the Workflow Engine determines when capabilities are
used.

### CLI Commands

```
specta init
specta plan
specta implement
specta scaffold
specta compile
specta context
specta validate
specta import
specta mcp
```

These are workflow entry points. Each orchestrates multiple internal services
rather than calling a single engine directly.

---

# Success Criteria

The MVP is successful if Specta can:

- Create a new workspace
- Import an existing repository
- Support a monorepo
- Build a Workspace Graph
- Compile optimized context
- Reduce prompt size
- Improve implementation quality
- Work with compatible coding agents through Agent Integrations
- Expose reusable MCP capabilities for integrations and platform consumers

---

# v0.2 — Project Intelligence

## Goal

Improve project understanding and planning.

### Features

- Incremental graph compilation
- Better dependency analysis
- Story decomposition
- Requirement traceability
- Architecture visualization
- Graph visualization
- Impact analysis
- Missing implementation detection
- Orphan code detection

---

# v0.3 — Multi-Language Support

## Goal

Support modern polyglot repositories.

### Language Parsers

- Python
- Go
- Rust
- Java
- C#

### Improvements

- Cross-language dependency analysis
- Shared Workspace Graph
- Better symbol resolution

---

# v0.4 — Extensibility

## Goal

Allow developers to extend Specta.

### Plugin System

- Language parsers
- Validators
- Scaffold templates
- Importers
- Planning providers
- LLM providers
- Prompt template library
- Agent adapters

### Workflow SDK

- Embed and extend Workflow Engine execution
- Register prompt templates and Agent Adapters
- Build community integrations without changing the Workflow Engine

### Integrations

- GitHub
- Jira
- Linear
- Notion

---

# v0.5 — Developer Experience

## Goal

Make Specta part of the everyday development workflow.

### Integrations

- Codex Integration
- Claude Code Integration
- Cursor Integration
- VS Code Extension
- JetBrains Plugin
- GitHub Copilot Integration
- Community Integrations
- GitHub Actions

### Improvements

- Interactive graph explorer
- Workspace visualization
- Performance improvements
- Context benchmarking
- Build analytics

---

# v1.0 — Specta Platform

## Goal

Become the standard infrastructure layer for AI-assisted software engineering.

### Platform Features

- Team workspaces
- Cloud synchronization
- Shared project graphs
- Enterprise policy validation
- Organization-wide architecture rules
- Hosted Workspace Graph
- Graph API
- Marketplace for plugins

---

# Guiding Principles

Every feature added to Specta should improve one or more of the following:

- Planning
- Project understanding
- Context quality
- Token efficiency
- Validation
- Developer productivity

If a feature does not contribute to these goals, it should not become part of the core platform.
