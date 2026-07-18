# Manual agent-workflow test

This directory contains instructions only. Create a throwaway TypeScript project
next to it; do not treat this directory as generated application code.

## Setup

```bash
mkdir /tmp/specta-manual-test
cd /tmp/specta-manual-test
printf '{"name":"specta-manual-test","private":true}\n' > package.json
node /home/brian-wachanga/Projects/specta/apps/cli/bin/specta.mjs init . --agent codex
```

Use the generated native Skill commands inside your coding agent. `plan`,
`design`, and `scaffold` are agent commands, not normal terminal commands. The
agent reasons from the brief, Workspace Graph context, and prompt template,
writes the requested draft, and invokes the local CLI helper internally.

Initialization installs active Codex Skills in `.codex/skills/`, retains
generated Specta artifacts in `.specta/skills/codex/`, and writes the local
runner to `.specta/runtime.json`. Open the target project in Codex after init
so it can discover the installed Skills.

## Planning stages

Run the corresponding native agent commands in order. Foundation submits only
agent-authored Vision and Constitution content. Architecture submits only its
overview and components. Specta loads approved upstream state from the graph,
validates new content and assigns deterministic IDs.

```bash
$specta-plan-foundation Build a task tracker
$specta-plan-architecture Use a local-first TypeScript architecture with SQLite
$specta-plan-roadmap
$specta-plan-epics
```

Architecture guidance is optional. Invoke `$specta-plan-architecture` without
additional text when the approved Foundation contains enough context.

Inspect `.specta/planning/` and `.specta/graph/planning-relationships.json`
after each command. The agent must preserve approved upstream artifacts in every
later draft; Specta rejects drafts that replace them or advance more than one
stage.

## Technical design and scaffold

Choose an Epic ID from the planning graph. Ask the agent to create a technical
design draft from that Epic, Architecture, existing files, and dependencies.

```text
$specta-design <epic-id>
$specta-approve-design <design-id>
$specta-scaffold <design-id>
```

For `design`, the agent authors a JSON technical-design draft containing its
summary, modules, files, exports, dependencies, and impact requests. Specta
renders the reviewable Markdown design and persists graph state. The developer
reviews it, asks the agent for changes by re-running `design` with feedback, and
approves the chosen revision.

For `scaffold`, the agent creates every file declared in the approved design.
Specta does not generate source files; it verifies the agent-created paths and
registers them in the graph.

For diagnostics only, inspect `.specta/runtime.json`. A Skill reads its
`cliCommand` and prepends it to its helper arguments. Do not use these helpers
as the normal developer workflow:

```bash
node /home/brian-wachanga/Projects/specta/apps/cli/bin/specta.mjs plan foundation "Build a task tracker" --draft .specta/drafts/plan-foundation.json
```

Inspect `.specta/designs/` and `.specta/graph/technical-designs.json`. Confirm
that existing files were preserved and generated skeletons contain declarations,
not business logic.
