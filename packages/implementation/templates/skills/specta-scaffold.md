---
name: "specta-scaffold"
description: "Create folders and declaration-only code skeletons from an approved technical design."
---

# specta-scaffold — Specta Skill

Workflow: scaffold
Description: Create folders and declaration-only code skeletons from an approved technical design.
Prompt template: .specta/workflows/prompts/scaffold.md
Validation: workflow-state

This implementation Skill is the native command surface. Read the referenced prompt template, then invoke the Specta Workflow Engine.
CLI helper arguments: scaffold <design-id>
Read .specta/runtime.json and append these arguments to its cliCommand.
