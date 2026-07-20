---
name: "specta-plan-foundation"
description: "Create a project's initial Vision and Constitution from a user-supplied brief. Use when starting Specta planning, when the user invokes specta-plan-foundation, or when Foundation artifacts do not yet exist."
---

# Specta Plan Foundation

Workflow: `plan-foundation`

Create only the Foundation stage. Let the coding agent reason about the project; let Specta validate, assign IDs, render Markdown, and update the Workspace Graph.

## Procedure

1. Work from the initialized workspace root containing `.specta/workspace.json`.
2. Treat all text supplied with the Skill invocation as the project brief.
3. If no non-empty brief was supplied, ask: “What project are you working on? Describe the problem, intended users, and desired outcome.” Wait for the answer before continuing. Never invent a brief.
4. Read `.specta/workflows/prompts/plan-foundation.md` and follow its reasoning and output contract.
5. Write only the JSON object produced from that contract to `.specta/drafts/plan-foundation.json`. Do not wrap it in Markdown or add commentary.
6. Read `.specta/runtime.json`. Execute its `cliCommand` from the workspace root with these arguments:

```text
plan foundation <brief> --draft .specta/drafts/plan-foundation.json
```

Pass the brief as one quoted argument. The CLI helper is an internal implementation detail; do not ask the user to run it.

7. If Specta rejects the JSON, correct only the reported draft problem and retry. Do not edit generated planning Markdown directly.
8. On success, verify `.specta/planning/vision.md`, `.specta/planning/constitution.md`, and `.specta/graph/planning-relationships.json`. Report those paths and the completed `foundation` stage.
