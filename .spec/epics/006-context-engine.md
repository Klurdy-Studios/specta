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
- Compile an implementation packet for one graph-selected Epic and its ordered
  Stories and Tasks.

## Deliverables

- `specta context`

## Acceptance Criteria

- Context generated.
- Token usage reduced.
- Required specifications included.
- Workflow commands automatically include the required optimized context.
- Epic implementation context includes acceptance criteria, architecture
  constraints, approved Technical Design, dependencies, relevant source files,
  and tests.
- Context requests are keyed by the selected Epic and Implementation Run so an
  interrupted native-agent workflow can be resumed deterministically.
