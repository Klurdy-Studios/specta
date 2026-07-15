# Epic 006 — Context Engine

## Goal

Compile optimized development context for workflow execution by coding agents.

## Description

The Context Engine traverses the Workspace Graph and produces the smallest
context necessary for the current workflow. Workflow commands invoke context
generation automatically.

## User Stories

- Compile context.
- Resolve requirements.
- Resolve dependencies.
- Optimize tokens.
- Rank relevance.
- As a coding agent, I receive only the information required for the current workflow.
- As a developer, I want implementation workflows to minimize unnecessary context.
- As a developer, I want context generation to be automatic.

## Deliverables

- `specta context`

## Acceptance Criteria

- Context generated.
- Token usage reduced.
- Required specifications included.
- Workflow commands automatically include the required optimized context.
