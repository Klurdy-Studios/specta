---
name: "specta-design"
description: "Create a reviewable technical design for one Epic."
---

# specta-design — Specta Skill

Workflow: design
Description: Create a reviewable technical design for one Epic.
Prompt template: .specta/workflows/prompts/design.md
Validation: workflow-state

This implementation Skill is the native command surface. Read the referenced prompt template, then invoke the Specta Workflow Engine.
CLI helper arguments: design <epic-id> --draft <draft.json> [--feedback <changes>]
Read .specta/runtime.json and append these arguments to its cliCommand.
