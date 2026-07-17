# Epic 002 — Project Planning

## Goal

Generate structured software specifications before implementation begins.

## Description

Planning is a workflow that converts an idea into structured documentation that
guides implementation. Developers invoke it through native agent Skills, not
terminal commands. The coding agent reasons from Specta context and templates;
Specta validates and persists the submitted artifact.

## User Stories

- Generate Foundation: Vision and Constitution from a brief.
- Generate Architecture from the approved Foundation.
- Generate Roadmap from Foundation and Architecture.
- Generate Epics from the approved prior artifacts.
- Generate Stories, acceptance criteria and Tasks within their owning Epic
  Markdown file.
- Run planning from a supported coding agent.

## Deliverables

- Native `plan-foundation`, `plan-architecture`, `plan-roadmap`, and
  `plan-epics` Skills.
- CLI helpers are internal Skill implementation details.

## Acceptance Criteria

- Foundation is generated before Architecture.
- Architecture requires Vision and Constitution; Roadmap requires Foundation and
  Architecture; Epics require all earlier planning artifacts.
- Each stage generates only its own documents using Markdown artifact templates.
- The coding agent authors each stage draft from Specta-provided context and
  templates; Specta validates and persists it.
- Each completed stage incrementally updates the Workspace Graph and workflow
  state.
- Existing approved upstream artifacts are preserved by later stages.
- Epic Markdown documents own their nested Stories, acceptance criteria and
  Tasks; they are not stored as separate planning files.
- Planning stages are available through generated native Skills and commands.
- Developers do not need to run planning CLI commands directly.
