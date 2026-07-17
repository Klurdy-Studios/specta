# Specta plan-foundation workflow

## Objective

Reason from the user's project brief and produce the semantic content for two Foundation artifacts: Vision and Constitution. Do not design the architecture, roadmap, epics, implementation, or source code during this stage.

## Vision

Develop these sections:

- `title`: a concise name or descriptive title for the project.
- `problem`: the concrete problem, current pain, and why solving it matters.
- `audience`: the primary users, customers, operators, or stakeholders.
- `outcome`: the observable change or value the project should create.

Keep the Vision specific to the supplied brief. Do not insert Specta's own product goals unless the project itself is Specta.

## Constitution

Produce a short list of durable, project-specific principles that will guide later architecture and implementation decisions. Prefer clear decision rules over slogans. Cover the most important quality, product, operational, security, or maintainability constraints implied by the brief.

Do not prescribe modules, frameworks, vendors, file layouts, milestones, or tasks. Those belong to later planning stages.

## Output

Return content matching this JSON shape:

```json
{
  "vision": {
    "title": "string",
    "problem": "string",
    "audience": "string",
    "outcome": "string"
  },
  "constitution": {
    "principles": ["non-empty unique string"]
  }
}
```

Every string must be meaningful and non-empty. Principles must be unique. Do not include IDs or workflow state; Specta creates those deterministically after validation.
