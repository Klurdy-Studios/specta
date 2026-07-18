# Planner public API

- planningWorkflowModule supplies planning Workflow Definitions and maintained
  prompt and Skill assets.
- createPlanWorkflow(...) executes a requested progressive planning stage.
- createDeterministicPlanningProvider() creates the built-in deterministic planning provider.
- createPlanner(provider?) creates structured plans and validates them.
- createPlanningArtifactRepository(fileSystem?) persists and loads template-rendered planning artifacts.
- createProgressivePlanner(provider?) supports legacy deterministic Foundation,
  Architecture and Epics generation; Roadmap content must be agent-authored.
- createFoundationPlanningState(brief, draft) validates agent-authored Vision
  and Constitution content and assigns deterministic graph IDs.
- createArchitecturePlanningState(state, draft, guidance?) validates agent-authored
  Architecture content while preserving Foundation.
- createRoadmapPlanningState(state, draft) validates ordered milestone titles,
  objectives and outcomes while assigning deterministic graph metadata.
- createPlanningStateRepository(fileSystem?) reads incremental planning state
  from the Workspace Graph and persists stage documents.
- createPlanningStateGraphUpdater(fileSystem?) updates the Workspace Graph after
  each completed planning stage.

The package is agent-agnostic. Planning stages are Foundation, Architecture,
Roadmap and Epics; Epic Markdown documents contain their Stories and Tasks.
