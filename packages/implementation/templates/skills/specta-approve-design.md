---
name: "specta-approve-design"
description: "Approve the latest reviewed Technical Design."
---

# specta-approve-design — Specta Skill

Workflow: approve-design
Prompt template: .specta/workflows/prompts/approve-design.md

Read the prompt, show the developer the project/framework decision and dependency state, and obtain explicit approval.

CLI helper arguments: approve-design <design-id>
Read .specta/runtime.json and append these arguments to its cliCommand.
