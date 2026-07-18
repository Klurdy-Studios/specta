---
name: "specta-plan-roadmap"
description: "Generate an ordered, outcome-oriented Roadmap from approved Foundation and Architecture artifacts."
---

# Specta Plan Roadmap

Workflow: `plan-roadmap`

Create only the Roadmap planning stage. The approved planning state in the Workspace Graph is the source of truth; do not ask the user to repeat it or copy upstream artifacts into the draft.

## Procedure

1. Work from the initialized workspace root containing `.specta/workspace.json`.
2. Read `.specta/graph/planning-relationships.json`. Confirm `completedStages` is exactly `["foundation", "architecture"]` and use its `planning.vision`, `planning.constitution`, and `planning.architecture` as the authoritative context. If Roadmap is already complete, stop and report its existing path. If either prerequisite is absent, stop and tell the user which earlier Specta planning Skill to run.
3. Read `.specta/workflows/prompts/plan-roadmap.md` and follow its reasoning and output contract using the approved planning context.
4. Write only the JSON object produced from that contract to `.specta/drafts/plan-roadmap.json`. Do not wrap it in Markdown or add commentary.
5. Read `.specta/runtime.json`. Execute its `cliCommand` from the workspace root with these arguments:

```text
plan roadmap --draft .specta/drafts/plan-roadmap.json
```

The CLI helper is an internal implementation detail; do not ask the user to run it.

6. If Specta rejects the JSON, correct only the reported draft problem and retry. Do not edit generated planning Markdown or graph JSON directly.
7. On success, verify `.specta/planning/roadmap.md` and `.specta/graph/planning-relationships.json`. Report those paths and the completed `roadmap` stage.
