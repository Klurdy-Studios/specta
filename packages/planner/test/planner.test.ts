import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { Workspace } from "@specta/core"
import {
  createPlanner,
  createArchitecturePlanningState,
  createFoundationPlanningState,
  createRoadmapPlanningState,
  createPlanningArtifactRepository,
  createProgressivePlanner,
} from "../src/index.js"
import { renderRoadmap } from "../src/templates.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function workspace(): Promise<Workspace> {
  const rootPath = await mkdtemp(join(tmpdir(), "specta-plan-"))
  temporaryDirectories.push(rootPath)
  return {
    schemaVersion: 1,
    id: "ws_test" as Workspace["id"],
    rootPath,
    createdAt: "2026-01-01T00:00:00.000Z",
    packageManager: "unknown",
    projects: [],
    artifacts: {},
    workflow: {
      skillTargets: [],
      manifestPath: ".specta/workflows/manifest.json",
    },
  }
}

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

  it("does not invoke a planning provider for Roadmap authoring", async () => {
    const target = await workspace()
    const foundation = createFoundationPlanningState("Build a task tracker.", {
      vision: { title: "Tasks", problem: "Work is lost.", audience: "Teams.", outcome: "Work is traceable." },
      constitution: { principles: ["Keep work traceable."] },
    })
    const architecture = createArchitecturePlanningState(foundation, {
      overview: "A bounded planning system.",
      components: ["Planning boundary — manages plans"],
    })
    let calls = 0
    const planner = createProgressivePlanner({
      async generate() {
        calls += 1
        return { title: "Unused", problem: "Unused", audience: "Unused", outcome: "Unused" }
      },
    })

    await expect(planner.generate({ workspace: target, stage: "roadmap", state: architecture }))
      .rejects.toThrow("agent-authored draft")
    expect(calls).toBe(0)
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

  it("renders template-based planning artifacts with stories and tasks inside the epic", async () => {
    const target = await workspace()
    const plan = await createPlanner().createPlan({
      workspace: target,
      brief: "Build a secure authentication workflow for product developers.",
    })
    const artifacts = await createPlanningArtifactRepository().save(target, plan)

    expect(artifacts.documents.map((document) => document.path)).toContain(".specta/planning/vision.md")
    expect(artifacts.documents.map((document) => document.path)).toContain(".specta/planning/epics/001-build-a-secure-authentication-workflow-for-product-developers.md")
    const epic = await readFile(join(target.rootPath, ".specta", "planning", "epics", "001-build-a-secure-authentication-workflow-for-product-developers.md"), "utf8")
    expect(epic).toContain("## Story — Establish a secure authentication workflow for product developers")
    expect(epic).toContain("### Tasks")
  })

  it("derives plan content from the planning brief and rejects invalid persisted plans", async () => {
    const target = await workspace()
    const planner = createPlanner()
    const authenticationPlan = await planner.createPlan({ workspace: target, brief: "Build an authentication API." })
    const portalPlan = await planner.createPlan({ workspace: target, brief: "Create a developer portal." })

    expect(authenticationPlan.architecture.components).toContain("Authentication boundary")
    expect(authenticationPlan.architecture.components).toContain("API boundary")
    expect(portalPlan.architecture.components).not.toContain("Authentication boundary")

    const repository = createPlanningArtifactRepository()
    await repository.save(target, authenticationPlan)
    await writeFile(join(target.rootPath, ".specta", "planning", "plan.json"), "{}", "utf8")
    await expect(repository.load(target)).rejects.toThrow("Unable to read the persisted project plan")
  })

  it("passes the prior graph-backed planning state and prompt to later stages", async () => {
    const target = await workspace()
    const requests: Array<{ context?: unknown | undefined, prompt?: string | undefined }> = []
    const planner = createProgressivePlanner({
      async generate(request) {
        requests.push({ context: request.context, prompt: request.prompt })
        return { title: "Planning", problem: request.brief, audience: "Developers", outcome: "A planned outcome." }
      },
    })
    const foundation = await planner.generate({ workspace: target, stage: "foundation", brief: "Plan the workspace.", state: null, prompt: "foundation prompt" })
    await planner.generate({ workspace: target, stage: "architecture", state: foundation, prompt: "architecture prompt" })

    expect(requests[1]?.context).toMatchObject({ vision: foundation.vision, constitution: foundation.constitution })
    expect(requests[1]?.prompt).toBe("architecture prompt")
  })
})
