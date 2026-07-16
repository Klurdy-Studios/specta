# Planner public API

- createDeterministicPlanningProvider() creates the built-in deterministic planning provider.
- createPlanner(provider?) creates structured plans and validates them.
- createPlanningArtifactRepository(fileSystem?) persists and loads template-rendered planning artifacts.
- createPlanningGraphUpdater(fileSystem?) persists validated planning relationships for the Workspace Graph.

The package is agent-agnostic. A future Agent Integration may implement
PlanningProvider without changing planner behavior.
