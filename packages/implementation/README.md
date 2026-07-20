# Implementation public API

The implementation package coordinates Epic-scoped Technical Designs and
declaration-only scaffolding performed by an external coding agent.

## Project profiles

- createProjectProfileResolver deterministically detects existing Next.js,
  React, Angular, NestJS, Express, or plain TypeScript projects.
- Frameworks are project metadata, not adapters.
- Blank-project framework and toolchain selections are explicit Technical
  Design inputs.

## Language adapters

- createLanguageAdapterRegistry resolves language adapters.
- typeScriptLanguageAdapter is the only built-in adapter in the MVP.
- It validates TypeScript and TSX exports and rejects executable bodies in new
  Epic-owned scaffold files.

## Workflows

- createTechnicalDesignWorkflow creates an immutable design revision.
- createTechnicalDesignApprovalWorkflow approves the latest language-valid,
  dependency-valid revision.
- createScaffoldWorkflow exposes prepare and finalize. Prepare records
  preservation hashes and optional framework bootstrap instructions; finalize
  validates agent-created declarations and updates the Workspace Graph.
- Blank-project preparation searches installed agent Skills for the selected
  framework and returns an explicit online npx skills find command. Discovery
  never installs or executes a Skill automatically.
- implementationWorkflowModule supplies the design, approve-design, and
  scaffold Workflow Definitions and maintained native Skill assets.

## Storage

Technical Designs, project profiles, and scaffold runs are persisted through
repositories owned by the graph package. The implementation package contains
no independent storage format.
