# Workflow public API

- createPlanWorkflow(...) executes the next eligible or explicitly requested
  planning stage. It accepts an optional `stage` (`foundation`, `architecture`,
  `roadmap`, `epics`, or `next`), a Foundation brief, and an agent-authored
  draft. Foundation drafts contain Vision and Constitution content without IDs;
  Specta validates them and constructs graph-owned planning state.
- createWorkflowManifestRepository(fileSystem?) loads and initializes canonical
  Workflow Definitions.
- defaultWorkflowManifest() returns the built-in Workflow Manifest.
- createTechnicalDesignWorkflow(...) creates a reviewable technical design for
  one Epic.
- createTechnicalDesignApprovalWorkflow(...) approves a dependency-valid design.
- createScaffoldWorkflow(...) writes declaration-only files from an approved
  technical design without overwriting existing files.
- createTechnicalDesignRepository(...) persists technical-design revisions and
  scaffolded paths in the Workspace Graph.

The workflow coordinates dependency checks, Markdown template rendering,
incremental artifact persistence and Workspace Graph updates. Generated Skills
are the primary command surface; they may invoke the CLI as an execution helper.
Workflow Definitions remain platform-independent and do not depend on a specific
coding agent.
