---
name: "specta-approve-design"
description: "Approve a reviewed technical design."
---

# specta-approve-design — Specta Skill

Workflow: approve-design
Description: Approve a reviewed technical design.
Prompt template: .specta/workflows/prompts/approve-design.md
Validation: workflow-state

This Skill is the native command surface. Read the referenced prompt template, then invoke the Specta Workflow Engine.
CLI helper arguments: approve-design <design-id>
Read .specta/runtime.json and append these arguments to its cliCommand.
