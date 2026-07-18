---
name: "specta-plan-epics"
description: "Generate Epics with nested Stories, acceptance criteria and Tasks."
---

# specta-plan-epics — Specta Skill

Workflow: plan-epics
Description: Generate Epics with nested Stories, acceptance criteria and Tasks.
Prompt template: .specta/workflows/prompts/plan-epics.md
Validation: planning-stage

This planning Skill is the native command surface. Read the referenced prompt template, then invoke the Specta Workflow Engine.
CLI helper arguments: plan epics --draft <epics-draft.json>
Read .specta/runtime.json and append these arguments to its cliCommand.
