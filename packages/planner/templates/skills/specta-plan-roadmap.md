---
name: "specta-plan-roadmap"
description: "Generate Roadmap from approved planning artifacts."
---

# specta-plan-roadmap — Specta Skill

Workflow: plan-roadmap
Description: Generate Roadmap from approved planning artifacts.
Prompt template: .specta/workflows/prompts/plan-roadmap.md
Validation: planning-stage

This planning Skill is the native command surface. Read the referenced prompt template, then invoke the Specta Workflow Engine.
CLI helper arguments: plan roadmap --draft <roadmap-draft.json>
Read .specta/runtime.json and append these arguments to its cliCommand.
