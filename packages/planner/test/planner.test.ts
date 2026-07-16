import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { Workspace } from "@specta/core"
import {
  createPlanner,
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
