import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { Workspace } from "@specta/core"
import {
  createPlanner,
  createArchitecturePlanningState,
  createFoundationPlanningState,
  createPlanningArtifactRepository,
  createPlanningGraphUpdater,
  createProgressivePlanner,
} from "../src/index.js"

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

    const first = createArchitecturePlanningState(foundation, draft)
    const second = createArchitecturePlanningState(foundation, draft)

    expect(first).toEqual(second)
    expect(first.completedStages).toEqual(["foundation", "architecture"])
    expect(first.vision).toEqual(foundation.vision)
    expect(first.constitution).toEqual(foundation.constitution)
    expect(first.architecture?.id).toMatch(/^plan_/)
    expect(first.relationships).toHaveLength(2)
    expect(() => createArchitecturePlanningState(foundation, {
      ...draft,
      components: ["Graph boundary", "graph boundary"],
    })).toThrow("components must be unique")
    expect(() => createArchitecturePlanningState(foundation, {
      ...draft,
      id: "agent-supplied-id",
    })).toThrow("id")
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

  it("persists validated planning relationships for graph compilation", async () => {
    const target = await workspace()
    const plan = await createPlanner().createPlan({ workspace: target, brief: "Plan a developer portal." })

    await createPlanningGraphUpdater().apply(target, plan.relationships)

    const graph = JSON.parse(await readFile(join(target.rootPath, ".specta", "graph", "planning-relationships.json"), "utf8"))
    expect(graph.relationships).toEqual(plan.relationships)
    expect(graph.relationships).toHaveLength(6)
    expect(graph.nodes).toHaveLength(7)
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
