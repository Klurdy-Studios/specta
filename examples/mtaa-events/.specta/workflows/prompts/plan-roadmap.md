# Specta plan-roadmap workflow

## Objective

Reason from the approved Vision, Constitution, and Architecture in the Workspace Graph and produce only the semantic content of the Roadmap artifact. The Roadmap orders meaningful delivery outcomes; it does not define epics, stories, tasks, technical designs, files, or source code.

## Reasoning guidance

Use the Vision to keep every milestone directed toward the intended user and product outcome. Apply the Constitution as constraints on delivery. Use the Architecture to identify the capabilities and boundaries that must become usable, without mechanically creating one milestone per component.

Choose the smallest coherent sequence that can deliver the Vision. Each milestone should represent an observable delivery state, not an activity such as “work on the API.” Order milestones so foundations and risk-reducing outcomes precede capabilities that depend on them. Keep the scope appropriate to the approved project; do not invent dates, owners, budgets, vendors, or requirements.

## Roadmap sections

- `title`: a concise, distinct name for the delivery milestone.
- `objective`: the outcome the milestone exists to achieve and why it matters.
- `outcomes`: concrete, observable results that indicate the milestone has been delivered.

## Output

Return content matching exactly this JSON shape:

```json
{
  "milestones": [
    {
      "title": "meaningful non-empty string",
      "objective": "meaningful non-empty string",
      "outcomes": ["non-empty unique string"]
    }
  ]
}
```

Include at least one milestone and at least one outcome per milestone. Milestone titles and outcomes within each milestone must be unique. Do not include IDs, dates, status, dependencies, Vision, Constitution, Architecture, workflow state, graph relationships, or Markdown; Specta loads and preserves upstream state and creates graph metadata deterministically.
