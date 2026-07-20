# Specta plan-epics workflow

## Objective

Reason from the approved Vision, Constitution, Architecture, and Roadmap in the Workspace Graph. Produce implementation-planning Epics containing user-centered Stories, testable acceptance criteria, and actionable Tasks. Do not create technical designs, modules, files, code, or tests during this stage.

## Reasoning guidance

Every Roadmap milestone must be covered by at least one Epic. An Epic must reference the exact title of the milestone it advances. Split a milestone into multiple Epics only when the resulting goals are independently deliverable; do not create artificial one-to-one mappings or catch-all Epics.

Use the Vision to preserve user value, the Constitution to constrain delivery decisions, and the Architecture to keep responsibilities aligned with approved boundaries. Epics describe cohesive delivery outcomes. Stories describe observable user, operator, or developer capabilities. Acceptance criteria must be specific, independently testable outcomes rather than implementation instructions. Tasks should be concrete units of work that help deliver a Story without prescribing file paths or source code.

Keep titles distinct at each level. Avoid duplicated criteria and tasks. Do not include IDs or graph relationships; Specta creates them deterministically after validation.

## Output

Return content matching exactly this JSON shape:

```json
{
  "epics": [
    {
      "title": "meaningful unique Epic title",
      "goal": "observable delivery goal",
      "roadmapMilestone": "exact approved Roadmap milestone title",
      "stories": [
        {
          "title": "meaningful unique Story title within the Epic",
          "description": "user-centered capability or requirement",
          "acceptanceCriteria": [
            "specific, observable, testable criterion"
          ],
          "tasks": [
            {
              "title": "meaningful unique Task title within the Story",
              "description": "actionable unit of delivery work"
            }
          ]
        }
      ]
    }
  ]
}
```

Include at least one Epic, one Story per Epic, one acceptance criterion per Story, and one Task per Story. Do not repeat upstream artifacts, completed stages, IDs, relationships, Markdown, or commentary.
