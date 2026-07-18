# Implementation public API

- `implementationWorkflowModule` supplies technical-design and scaffold
  Workflow Definitions and maintained Skill assets.
- `createTechnicalDesignWorkflow(...)` creates an Epic-scoped design.
- `createTechnicalDesignApprovalWorkflow(...)` approves a dependency-valid design.
- `createScaffoldWorkflow(...)` verifies agent-authored scaffold files.
- `createTechnicalDesignRepository(...)` persists design revisions in the graph.

Specta coordinates implementation but does not act as the coding agent.
