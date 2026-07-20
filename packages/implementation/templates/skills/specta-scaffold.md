---
name: "specta-scaffold"
description: "Prepare and finalize declaration-only scaffolding from an approved Technical Design."
---

# specta-scaffold — Specta Skill

Workflow: scaffold
Prompt template: .specta/workflows/prompts/scaffold.md

Read the prompt and orchestrate both phases. Frameworks are project metadata; TypeScript is the initial language adapter.

CLI helper arguments:
- scaffold <design-id> --prepare
- scaffold <design-id> --finalize <scaffold-run-id>

Read .specta/runtime.json and append each argument sequence to its cliCommand.
