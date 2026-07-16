# Workflow public API

- createPlanWorkflow(...) executes the next eligible or explicitly requested
  planning stage. It accepts an optional `stage` (`foundation`, `architecture`,
  `roadmap`, `epics`, or `next`) and a Foundation brief.
- createWorkflowManifestRepository(fileSystem?) loads and initializes canonical
  Workflow Definitions.
- defaultWorkflowManifest() returns the built-in Workflow Manifest.

The workflow coordinates dependency checks, Markdown template rendering,
incremental artifact persistence and Workspace Graph updates. Generated Skills
are the primary command surface; they may invoke the CLI as an execution helper.
Workflow Definitions remain platform-independent and do not depend on a specific
coding agent.
