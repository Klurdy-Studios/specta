# Planner public API

- planningWorkflowModule supplies planning Workflow Definitions and maintained
  prompt and Skill assets.
- createPlanWorkflow(...) executes a requested progressive planning stage.
- createDeterministicPlanningProvider() creates the built-in deterministic planning provider.
- createPlanner(provider?) creates structured plans and validates them.
- createPlanningArtifactRepository(fileSystem?) persists and loads template-rendered planning artifacts.
- createPlanningGraphUpdater(fileSystem?) persists validated planning relationships for the Workspace Graph.
- createProgressivePlanner(provider?) generates one dependency-aware planning stage at a time.
- createFoundationPlanningState(brief, draft) validates agent-authored Vision
  and Constitution content and assigns deterministic graph IDs.
- createPlanningStateRepository(fileSystem?) reads incremental planning state
  from the Workspace Graph and persists stage documents.
- createPlanningStateGraphUpdater(fileSystem?) updates the Workspace Graph after
  each completed planning stage.

The package is agent-agnostic. Planning stages are Foundation, Architecture,
Roadmap and Epics; Epic Markdown documents contain their Stories and Tasks.
