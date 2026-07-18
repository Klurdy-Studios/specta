---
name: "specta-plan-architecture"
description: "Generate Architecture from Vision and Constitution."
---

# Specta Plan Architecture

Workflow: `plan-architecture`

Create only the Architecture planning stage. The approved Foundation in the Workspace Graph is the source of truth; do not ask the user to repeat it or copy it into the draft.

## Procedure

1. Work from the initialized workspace root containing `.specta/workspace.json`.
2. Capture all text supplied with the Skill invocation as optional architecture guidance. If no text was supplied, continue without prompting for guidance.
3. Read `.specta/graph/planning-relationships.json`. Confirm `completedStages` is exactly `["foundation"]` and use its `planning.vision` and `planning.constitution` as the authoritative context. If Foundation is absent, stop and tell the user to run `specta-plan-foundation` first.
4. Read `.specta/workflows/prompts/plan-architecture.md` and follow its reasoning and output contract using Foundation and the optional guidance.
5. Write only the JSON object produced from that contract to `.specta/drafts/plan-architecture.json`. Do not wrap it in Markdown or add commentary.
6. Read `.specta/runtime.json`. Execute its `cliCommand` from the workspace root with these arguments:

```text
plan architecture [<guidance>] --draft .specta/drafts/plan-architecture.json
```

When guidance was supplied, pass it as one quoted argument in place of `[<guidance>]`; otherwise omit the bracketed argument. The CLI helper is an internal implementation detail; do not ask the user to run it.

7. If Specta rejects the JSON, correct only the reported draft problem and retry. Do not edit generated planning Markdown or graph JSON directly.
8. On success, verify `.specta/planning/architecture.md` and `.specta/graph/planning-relationships.json`. Report those paths and the completed `architecture` stage.
