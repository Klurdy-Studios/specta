---
name: "specta-plan-architecture"
description: "Generate Architecture from Vision and Constitution."
---

# Specta Plan Architecture

Workflow: `plan-architecture`

Create only the Architecture planning stage. The approved Foundation in the Workspace Graph is the source of truth; do not ask the user to repeat it or copy it into the draft.

## Procedure

1. Work from the initialized workspace root containing `.specta/workspace.json`.
2. Treat all text supplied with the Skill invocation as optional architecture guidance. It may describe required technologies, integrations, deployment constraints, data boundaries, system qualities, or preferred architectural boundaries. If no text was supplied, continue from the approved Foundation without prompting for guidance.
3. Read `.specta/graph/planning-relationships.json`. Confirm `completedStages` is exactly `["foundation"]` and use its `planning.vision` and `planning.constitution` as the authoritative context. If Foundation is absent, stop and tell the user to run `specta-plan-foundation` first.
4. If supplied guidance conflicts with the Constitution or intended outcome, ask the user to resolve the conflict before continuing. Otherwise, use it as additional input without weakening or replacing Foundation decisions.
5. Read `.specta/workflows/prompts/plan-architecture.md` and follow its reasoning guidance.
6. Write the resulting JSON to `.specta/drafts/plan-architecture.json` using exactly this content shape:

```json
{
  "overview": "A concise description of the system shape and how it satisfies the Foundation",
  "components": [
    "A meaningful architectural boundary and its responsibility"
  ]
}
```

Do not add an ID, Foundation artifacts, planning stages, relationships, Markdown, code fences, vendors, file paths, or commentary to the JSON file.

7. Read `.specta/runtime.json`. Execute its `cliCommand` from the workspace root with these arguments:

```text
plan architecture --draft .specta/drafts/plan-architecture.json
```

The CLI helper is an internal implementation detail; do not ask the user to run it.

8. If Specta rejects the JSON, correct only the reported draft problem and retry. Do not edit generated planning Markdown or graph JSON directly.
9. On success, verify `.specta/planning/architecture.md` and `.specta/graph/planning-relationships.json`. Report those paths and the completed `architecture` stage.
