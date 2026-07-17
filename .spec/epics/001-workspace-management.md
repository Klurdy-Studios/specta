# Epic 001 — Workspace Management

## Goal

Enable Specta to initialize and manage software workspaces regardless of whether they are new projects, existing repositories, or monorepos.

## Description

Workspace is the root entity in Specta.

Every repository is represented as a Workspace.

A traditional repository is simply a workspace containing a single project.

A monorepo contains multiple projects and shared packages.

Initialization also prepares the workspace for agent-agnostic Specta workflows.

## User Stories

- As a developer, I want to initialize a Specta workspace.
- As a developer, I want Specta to detect existing repositories.
- As a developer, I want Specta to detect monorepos automatically.
- As a developer, I want workspace configuration stored in a standard location.
- As a developer, I want to select supported native Skill targets for my workspace.
- As a Codex developer, I want initialization to install Skills into the active
  `.codex/skills/` directory.
- As a local Specta contributor, I want installed Skills to use a configured
  local CLI runner before the CLI is published.
- As a developer, I want a new workspace to be ready for workflow commands.

## Deliverables

- `specta init`
- Workspace configuration
- Repository discovery
- Workspace metadata
- Workflow configuration
- Default workflow templates
- Generated AGENTS.md
- Native Skill installation
- Runtime CLI helper configuration

## Acceptance Criteria

- Workspace initializes successfully.
- Existing repositories are detected.
- Monorepos are supported.
- Configuration is persisted.
- The .specta directory and workflow configuration are created.
- AGENTS.md and default workflow templates are generated.
- A new workspace is immediately usable with the selected coding agent.
- Selecting Codex installs generated Skills into `.codex/skills/`; developers
  invoke workflows through those Skills rather than terminal commands.
- Runtime configuration records a local checkout runner for development or the
  published `specta` binary when available.
