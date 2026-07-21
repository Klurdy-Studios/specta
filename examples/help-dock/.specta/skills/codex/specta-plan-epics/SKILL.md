---
name: "specta-plan-epics"
description: "Generate graph-backed Epics with nested Stories, acceptance criteria and Tasks from an approved Roadmap."
---

# Specta Plan Epics

Workflow: `plan-epics`

Create only the Epics planning stage. The approved planning state in the Workspace Graph is authoritative; do not copy upstream artifacts or graph metadata into the draft.

## Procedure

1. Work from the initialized workspace root containing `.specta/workspace.json`.
2. Read `.specta/planning/vision.md`, `.specta/planning/constitution.md`, `.specta/planning/architecture.md`, and `.specta/planning/roadmap.md`. These are the validated planning views produced from the Workspace Graph. If `.specta/planning/epics/` already contains generated Epics, stop and report them. If a prerequisite view is absent, stop and tell the user which earlier Specta planning Skill to run.
3. Read `.specta/workflows/prompts/plan-epics.md` and follow its reasoning and output contract. Ensure every Roadmap milestone is referenced by at least one Epic.
4. Write only the JSON object from that contract to `.specta/drafts/plan-epics.json`. Do not wrap it in Markdown or add commentary.
5. Read `.specta/runtime.json`. Execute its `cliCommand` from the workspace root with these arguments:

```text
plan epics --draft .specta/drafts/plan-epics.json
```

The CLI helper is an internal implementation detail; do not ask the user to run it.

6. If Specta rejects the JSON, correct only the reported draft problem and retry. Do not edit generated planning Markdown or the Workspace Graph directly.
7. On success, verify `.specta/planning/epics/`. Report the generated Epic paths and the completed `epics` stage.
