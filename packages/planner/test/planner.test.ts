import { describe, expect, it } from "vitest"
import {
  createArchitecturePlanningState,
  createFoundationPlanningState,
  createEpicsPlanningState,
  createRoadmapPlanningState,
  validatePlanningState,
} from "../src/index.js"
import { renderEpic, renderRoadmap } from "../src/templates.js"

describe("planner", () => {
  it("validates Foundation content and assigns deterministic IDs", () => {
    const draft = {
      vision: {
        title: "Task Atlas",
        problem: "Teams lose track of project work.",
        audience: "Small product teams.",
        outcome: "Teams can plan and complete traceable work.",
      },
      constitution: {
        principles: ["Keep work traceable.", "Prefer simple project workflows."],
      },
    }

    const first = createFoundationPlanningState("Build a task tracker.", draft)
    const second = createFoundationPlanningState("Build a task tracker.", draft)

    expect(first).toEqual(second)
    expect(first.completedStages).toEqual(["foundation"])
    expect(first.vision?.id).toMatch(/^plan_/)
    expect(() => createFoundationPlanningState("Build a task tracker.", {
      ...draft,
      constitution: { principles: ["Keep work traceable.", "keep work traceable."] },
    })).toThrow("principles must be unique")
    expect(() => createFoundationPlanningState("Build a task tracker.", {
      ...draft,
      vision: { ...draft.vision, outcome: "" },
    })).toThrow("at vision.outcome")
    expect(() => createFoundationPlanningState("Build a task tracker.", {
      ...draft,
      completedStages: ["foundation"],
    })).toThrow("completedStages")
  })

  it("validates Architecture content and extends Foundation deterministically", () => {
    const foundation = createFoundationPlanningState("Build a task tracker.", {
      vision: {
        title: "Task Atlas",
        problem: "Teams lose track of project work.",
        audience: "Small product teams.",
        outcome: "Teams complete traceable work.",
      },
      constitution: { principles: ["Keep work traceable."] },
    })
    const draft = {
      overview: "A workflow boundary records and coordinates traceable project work.",
      components: ["Workflow boundary — coordinates project work", "Graph boundary — preserves traceability"],
    }

    const first = createArchitecturePlanningState(foundation, draft, "Use SQLite locally.")
    const second = createArchitecturePlanningState(foundation, draft, "Use SQLite locally.")

    expect(first).toEqual(second)
    expect(first.completedStages).toEqual(["foundation", "architecture"])
    expect(first.vision).toEqual(foundation.vision)
    expect(first.constitution).toEqual(foundation.constitution)
    expect(first.architecture?.id).toMatch(/^plan_/)
    expect(first.architecture?.guidance).toBe("Use SQLite locally.")
    expect(first.relationships).toHaveLength(2)
    expect(() => createArchitecturePlanningState(foundation, {
      ...draft,
      components: ["Graph boundary", "graph boundary"],
    })).toThrow("components must be unique")
    expect(() => createArchitecturePlanningState(foundation, {
      ...draft,
      id: "agent-supplied-id",
    })).toThrow("id")
    expect(() => createArchitecturePlanningState(foundation, {
      overview: draft.overview,
      components: [],
    })).toThrow("components")
    expect(() => createArchitecturePlanningState(first, draft)).toThrow("already complete")
    expect(() => createArchitecturePlanningState({
      brief: "Missing Foundation",
      completedStages: [],
      relationships: [],
    }, draft)).toThrow("requires a completed Foundation")
  })

  it("validates Roadmap content and assigns graph metadata deterministically", () => {
    const foundation = createFoundationPlanningState("Build a task tracker.", {
      vision: {
        title: "Task Atlas",
        problem: "Teams lose track of project work.",
        audience: "Small product teams.",
        outcome: "Teams complete traceable work.",
      },
      constitution: { principles: ["Keep work traceable."] },
    })
    const architecture = createArchitecturePlanningState(foundation, {
      overview: "A workflow-centered system keeps delivery traceable.",
      components: ["Workflow boundary — coordinates project work"],
    })
    const draft = {
      milestones: [{
        title: "Traceable planning",
        objective: "Enable teams to define and follow approved work.",
        outcomes: ["Teams can create traceable project plans."],
      }],
    }

    const first = createRoadmapPlanningState(architecture, draft)
    const second = createRoadmapPlanningState(architecture, draft)

    expect(first).toEqual(second)
    expect(first.completedStages).toEqual(["foundation", "architecture", "roadmap"])
    expect(first.vision).toEqual(architecture.vision)
    expect(first.architecture).toEqual(architecture.architecture)
    expect(first.roadmap?.id).toMatch(/^plan_/)
    expect(first.relationships.at(-1)).toEqual({
      type: "DEPENDS_ON",
      sourceId: first.roadmap?.id,
      targetId: architecture.architecture?.id,
    })
    expect(() => createRoadmapPlanningState(architecture, { ...draft, id: "agent-id" }))
      .toThrow("id")
    expect(() => createRoadmapPlanningState(architecture, { milestones: [] }))
      .toThrow("milestones")
    expect(() => createRoadmapPlanningState(first, draft)).toThrow("already complete")
    expect(() => createRoadmapPlanningState(foundation, draft))
      .toThrow("requires completed Foundation and Architecture")
  })

  it("validates Epics content, covers the Roadmap and assigns nested graph metadata", () => {
    const foundation = createFoundationPlanningState("Build a task tracker.", {
      vision: { title: "Tasks", problem: "Work is lost.", audience: "Teams.", outcome: "Work is traceable." },
      constitution: { principles: ["Keep work traceable."] },
    })
    const architecture = createArchitecturePlanningState(foundation, {
      overview: "A bounded planning system.",
      components: ["Planning boundary — manages plans"],
    })
    const roadmap = createRoadmapPlanningState(architecture, {
      milestones: [
        { title: "Planning MVP", objective: "Enable planning.", outcomes: ["Plans can be created."] },
        { title: "Delivery MVP", objective: "Enable delivery.", outcomes: ["Plans can be delivered."] },
      ],
    })
    const draft = {
      epics: roadmap.roadmap!.milestones.map((milestone) => ({
        title: milestone.title + " Epic",
        goal: milestone.objective,
        roadmapMilestone: milestone.title,
        stories: [{
          title: milestone.title + " Story",
          description: milestone.objective,
          acceptanceCriteria: [...milestone.outcomes, milestone.title + " remains traceable."],
          tasks: [
            { title: milestone.title + " Task", description: "Deliver the planned capability." },
            { title: "Validate " + milestone.title, description: "Validate the delivered capability." },
          ],
        }],
      })),
    }
    draft.epics.push({
      title: "Planning operations Epic",
      goal: "Operate planning reliably.",
      roadmapMilestone: "planning mvp",
      stories: [{
        title: "Operate planning",
        description: "Teams operate planning reliably.",
        acceptanceCriteria: ["Planning failures are observable."],
        tasks: [{ title: "Define planning operations", description: "Define operational planning behavior." }],
      }],
    })

    const first = createEpicsPlanningState(roadmap, draft)
    const second = createEpicsPlanningState(roadmap, draft)
    const caseVariant = createEpicsPlanningState(roadmap, {
      epics: draft.epics.map((epic, index) => index === 0 ? { ...epic, roadmapMilestone: "planning mvp" } : epic),
    })

    expect(first).toEqual(second)
    expect(caseVariant).toEqual(first)
    expect(first.completedStages).toEqual(["foundation", "architecture", "roadmap", "epics"])
    expect(first.epics).toHaveLength(3)
    expect(first.epics?.[0]?.stories[0]?.acceptanceCriteria[0]?.id).toMatch(/^plan_/)
    expect(first.relationships).toContainEqual({
      type: "CONTAINS",
      sourceId: first.epics?.[0]?.stories[0]?.id,
      targetId: first.epics?.[0]?.stories[0]?.acceptanceCriteria[0]?.id,
    })
    expect(first.relationships).toContainEqual({
      type: "DEPENDS_ON",
      sourceId: first.epics?.[0]?.id,
      targetId: roadmap.roadmap?.id,
    })
    expect(first.relationships).toContainEqual({
      type: "IMPLEMENTS",
      sourceId: first.epics?.[0]?.id,
      targetId: architecture.architecture?.id,
    })
    expect(first.relationships).toContainEqual({
      type: "CONTAINS",
      sourceId: first.epics?.[0]?.stories[0]?.id,
      targetId: first.epics?.[0]?.stories[0]?.tasks[0]?.id,
    })
    const criterionId = first.epics![0]!.stories[0]!.acceptanceCriteria[0]!.id
    expect(() => validatePlanningState({
      ...first,
      relationships: first.relationships.filter((relationship) => relationship.targetId !== criterionId),
    })).toThrow("missing required Epic relationships")
    expect(() => createEpicsPlanningState(roadmap, {
      epics: [draft.epics[0]],
    })).toThrow("missing: Delivery MVP")
    expect(() => createEpicsPlanningState(roadmap, {
      epics: [{ ...draft.epics[0], roadmapMilestone: "Unknown" }, draft.epics[1]],
    })).toThrow("unknown Roadmap milestone")
    expect(() => createEpicsPlanningState(first, draft)).toThrow("already complete")
  })

  it("renders the complete ordered Roadmap structure", () => {
    expect(renderRoadmap({
      id: "roadmap" as never,
      milestones: [
        { title: "First", objective: "Deliver the first outcome.", outcomes: ["First is complete."] },
        { title: "Second", objective: "Deliver the second outcome.", outcomes: ["Second is complete."] },
      ],
    })).toBe([
      "# Roadmap",
      "",
      "## 1. First",
      "",
      "**Objective:** Deliver the first outcome.",
      "",
      "### Outcomes",
      "",
      "- First is complete.",
      "",
      "## 2. Second",
      "",
      "**Objective:** Deliver the second outcome.",
      "",
      "### Outcomes",
      "",
      "- Second is complete.",
      "",
    ].join("\n"))
  })

  it("renders nested Stories, acceptance criteria and Tasks in an Epic document", () => {
    const markdown = renderEpic({
      id: "epic" as never,
      title: "Planning",
      goal: "Deliver traceable planning.",
      roadmapMilestone: "MVP",
      stories: [{
        id: "story" as never,
        title: "Create plans",
        description: "Teams create traceable plans.",
        acceptanceCriteria: [{ id: "criterion" as never, description: "A plan is persisted." }],
        tasks: [{ id: "task" as never, title: "Persist plans", description: "Store validated plans." }],
      }],
    })

    expect(markdown).toContain("# Epic — Planning")
    expect(markdown).toContain("## Story — Create plans")
    expect(markdown).toContain("- A plan is persisted.")
    expect(markdown).toContain("- [ ] Persist plans — Store validated plans.")
  })

})
