---
name: "specta-plan-architecture"
description: "Generate Architecture from Vision and Constitution."
---

# specta-plan-architecture — Specta Skill

Workflow: plan-architecture
Description: Generate Architecture from Vision and Constitution.
Prompt template: .specta/workflows/prompts/plan-architecture.md
Validation: planning-stage

This planning Skill is the native command surface. Read the referenced prompt template, then invoke the Specta Workflow Engine.
CLI helper arguments: plan architecture --draft <architecture-draft.json>
Read .specta/runtime.json and append these arguments to its cliCommand.
