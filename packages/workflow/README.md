# Workflow public API

- createPlanWorkflow(planner?, artifacts?, graphUpdater?) executes the planning workflow.

The workflow coordinates plan creation, template-based artifact persistence and
Workspace Graph relationship updates. It does not depend on a specific coding
agent or integration.
