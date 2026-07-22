---
name: "specta-implement"
description: "Implement one eligible Specta Epic using minimal graph context, authoritative validation, and run-level token accounting."
---

# specta-implement — Specta Skill

Workflow: implement
Prompt template: .specta/workflows/prompts/implement.md

Read the prompt before acting. You are the implementation author: use your reasoning to edit source code and tests. Specta only selects scope, supplies graph context, validates the result, and persists state.

CLI helper arguments:
- `implement <epic-id|next> --prepare --json`
- `implement <implementation-run-id> --finalize --evidence <evidence.json> [--token-usage <token-usage.json>] --json`

Read `.specta/runtime.json` and append each argument sequence to its `cliCommand`. Resume the same run after validation failure. At the end, output the returned token breakdown, distinguishing the estimated Context Packet tokens from coding-agent telemetry.
