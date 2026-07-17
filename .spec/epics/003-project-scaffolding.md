# Epic 003 — Project Scaffolding

## Goal

Generate approved project structure from Epic-scoped technical designs.

## Description

Scaffolding follows a `design` workflow that creates a reviewable technical
design for one Epic. After developer approval, scaffolding creates folders and
declaration-only implementation skeletons.

Business logic is intentionally excluded.

## User Stories

- Scaffold backend services.
- Scaffold frontend applications.
- Scaffold shared packages.
- Create and review a technical design for one Epic.
- Approve technical designs before scaffolding.
- Resolve dependencies on files and symbols owned by earlier Epics.
- Execute scaffolding from a supported coding agent.

## Deliverables

- Native `design`, `approve-design`, and `scaffold` Skills.
- CLI helpers are invoked internally by the selected agent's Skill.

## Acceptance Criteria

- Folder structure generated.
- Technical designs identify file paths, exports and signatures before files are
  generated.
- Scaffolding requires an approved technical design.
- Generated modules contain declarations only, not business logic.
- Existing files are preserved.
- Generated structures update the Workspace Graph.
- Cross-Epic dependencies are resolved before a design is approved and must be
  available before scaffolding.
- Scaffolding is executable through supported native Skills.
- Developers invoke design and scaffold workflows through their coding agent,
  not by running CLI commands directly.
