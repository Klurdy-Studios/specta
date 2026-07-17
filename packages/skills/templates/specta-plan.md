---
name: "specta-plan"
description: "Execute the next eligible planning stage."
---

# specta-plan — Specta Skill

Workflow: plan
Description: Execute the next eligible planning stage.
Prompt template: .specta/workflows/prompts/plan.md
Validation: none

This Skill is the native command surface. Read the referenced prompt template, then invoke the Specta Workflow Engine.
CLI helper arguments: plan --draft <planning-draft.json>
Read .specta/runtime.json and append these arguments to its cliCommand.
