---
name: "specta-design"
description: "Create a reviewable Technical Design for one Epic and target project."
---

# specta-design — Specta Skill

Workflow: design
Prompt template: .specta/workflows/prompts/design.md

Read the prompt template and follow its project-profile, language-adapter, and output contract.
Write the draft to .specta/drafts/design.json.

CLI helper arguments: design <epic-id> --draft .specta/drafts/design.json [--feedback <changes>]
Read .specta/runtime.json and append these arguments to its cliCommand.
