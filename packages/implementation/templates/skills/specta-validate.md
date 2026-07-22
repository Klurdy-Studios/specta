---
name: "specta-validate"
description: "Validate one Epic implementation against graph-backed requirements, design, tests, and project checks."
---

# specta-validate — Specta Skill

Workflow: validate
Prompt template: .specta/workflows/prompts/validate.md

Read the prompt, build explicit acceptance-criterion test evidence from the completed work, and run authoritative validation. Do not infer passing evidence from source inspection alone.

CLI helper arguments:
- validate <epic-id> --evidence <evidence.json>
- validate <epic-id> --run <implementation-run-id> --evidence <evidence.json>

Read .specta/runtime.json and append each argument sequence to its cliCommand.
