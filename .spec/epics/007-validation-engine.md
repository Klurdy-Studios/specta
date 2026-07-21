# Epic 007 — Validation Engine

## Goal

Validate implementation against project intent.

## Description

Validation ensures software satisfies requirements, architecture and acceptance
criteria. Implementation workflows execute validation automatically before
completion.

## User Stories

- Validate requirements.
- Validate architecture.
- Validate acceptance criteria.
- Validate tests.
- Reuse validation through Workflow Engine or MCP.
- Validate one Epic Implementation Run against its graph-backed intent.

## Deliverables

- `specta validate`

## Acceptance Criteria

- Validation report generated.
- Failed requirements identified.
- Missing tests reported.
- Implementation workflows validate outcomes automatically.
- Validation remains available independently through Workflow Engine or MCP.
- Validation reports identify the Epic, Stories, acceptance criteria,
  architecture constraints, files, and tests that passed or failed.
- A failed Implementation Run cannot mark its Epic complete or unlock dependent
  Epics.
- A successful report can be committed atomically with implementation status by
  the Epic Implementation Workflow.
