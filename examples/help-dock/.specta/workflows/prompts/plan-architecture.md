# Specta plan-architecture workflow

## Objective

Reason from the approved Vision and Constitution in the Workspace Graph and produce only the semantic content of the Architecture artifact. Do not create a roadmap, epics, stories, tasks, technical design, file layout, or source code.

## Reasoning guidance

Use the Vision to identify the system's purpose, users, outcome and essential capabilities. Use every Constitution principle as a durable constraint on the design.

The user may provide optional architecture guidance with the Skill invocation. Treat it as additional design input when it is consistent with the Foundation. Guidance may specify required technologies, integrations, deployment constraints, data boundaries, quality attributes, or preferred architectural boundaries. Do not require guidance when none was supplied, and never let it silently override the Constitution. Ask the user to resolve any material conflict.

Describe the smallest coherent system shape that can deliver the intended outcome. Identify stable responsibility boundaries rather than implementation files. Components may represent product surfaces, services, data or graph boundaries, workflow engines, integrations, or operational concerns when the Foundation justifies them.

Keep the Architecture technology-neutral unless the Foundation explicitly requires a technology. Do not invent vendors, frameworks, databases, deployment platforms, APIs, or security requirements that are not supported by the approved Foundation.

## Architecture sections

- `overview`: explain the overall system shape, how responsibilities collaborate, and how the design follows the Vision and Constitution.
- `components`: list distinct architectural boundaries. Each entry must state both the boundary and its responsibility. Avoid duplicate, vague, or purely aspirational component names.

## Output

Return content matching exactly this JSON shape:

```json
{
  "overview": "meaningful non-empty string",
  "components": [
    "Boundary — responsibility"
  ]
}
```

Every string must be meaningful and non-empty. Components must be unique. Do not include an ID or repeat Vision, Constitution, workflow state, relationships, or Markdown; Specta loads and preserves upstream state and creates graph metadata deterministically.
