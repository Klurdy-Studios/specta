import { getEdgeKinds, getNodeKinds } from "@nicia-ai/typegraph"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Workspace } from "@specta/core"
import { afterEach, describe, expect, it } from "vitest"
import { createPlanningGraphRepository, planningGraphSnapshotSchema, workspaceGraph } from "../src/index.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("workspace graph ontology", () => {
  it("defines typed planning nodes and relationships", () => {
    expect(getNodeKinds(workspaceGraph)).toEqual([
      "Vision",
      "Constitution",
      "Architecture",
      "Roadmap",
      "Epic",
      "Story",
      "Task",
      "TechnicalDesign",
      "Module",
      "File",
      "CodeSymbol",
    ])
    expect(getEdgeKinds(workspaceGraph)).toEqual(["CONTAINS", "DEPENDS_ON", "IMPLEMENTS"])
  })

  it("validates graph snapshots with Zod", () => {
    const snapshot = {
      schemaVersion: 2 as const,
      planning: {
        brief: "Build a task tracker.",
        completedStages: ["foundation"],
        vision: {
          id: "plan_vision",
          title: "Task Atlas",
          problem: "Teams lose track of work.",
          audience: "Product teams.",
          outcome: "Work remains traceable.",
        },
        constitution: {
          id: "plan_constitution",
          principles: ["Keep work traceable."],
        },
        relationships: [],
      },
      completedStages: ["foundation"],
      nodes: [
        { id: "plan_vision", type: "VISION" },
        { id: "plan_constitution", type: "CONSTITUTION" },
      ],
      relationships: [],
    }

    expect(planningGraphSnapshotSchema.parse(snapshot)).toEqual(snapshot)
    expect(() => planningGraphSnapshotSchema.parse({ ...snapshot, completedStages: [] }))
      .toThrow("Graph completed stages must match planning state")
  })

  it("owns validated planning-state persistence", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "specta-graph-"))
    temporaryDirectories.push(rootPath)
    const workspace: Workspace = {
      schemaVersion: 1,
      id: "ws_graph" as Workspace["id"],
      rootPath,
      createdAt: "2026-01-01T00:00:00.000Z",
      packageManager: "unknown",
      projects: [],
      artifacts: {},
      workflow: { skillTargets: [], manifestPath: ".specta/workflows/manifest.json" },
    }
    const planning = planningGraphSnapshotSchema.parse({
      schemaVersion: 2,
      planning: {
        brief: "Build a task tracker.",
        completedStages: ["foundation"],
        vision: { id: "plan_vision", title: "Task Atlas", problem: "Lost work.", audience: "Teams.", outcome: "Traceable work." },
        constitution: { id: "plan_constitution", principles: ["Keep work traceable."] },
        relationships: [],
      },
      completedStages: ["foundation"],
      nodes: [{ id: "plan_vision", type: "VISION" }, { id: "plan_constitution", type: "CONSTITUTION" }],
      relationships: [],
    }).planning
    const repository = createPlanningGraphRepository()

    await repository.savePlanningState(workspace, planning)

    await expect(repository.loadPlanningState(workspace)).resolves.toEqual(planning)
    await expect(readFile(join(rootPath, ".specta", "graph", "planning-relationships.json"), "utf8"))
      .resolves.toContain('"schemaVersion": 2')
  })

  it("migrates unversioned Roadmaps with string milestones", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "specta-legacy-roadmap-"))
    temporaryDirectories.push(rootPath)
    const workspace: Workspace = {
      schemaVersion: 1,
      id: "ws_legacy" as Workspace["id"],
      rootPath,
      createdAt: "2026-01-01T00:00:00.000Z",
      packageManager: "unknown",
      projects: [],
      artifacts: {},
      workflow: { skillTargets: [], manifestPath: ".specta/workflows/manifest.json" },
    }
    const path = join(rootPath, ".specta", "graph", "planning-relationships.json")
    await mkdir(join(rootPath, ".specta", "graph"), { recursive: true })
    await writeFile(path, JSON.stringify({
      planning: {
        brief: "Build a task tracker.",
        completedStages: ["foundation", "architecture", "roadmap"],
        vision: { id: "vision", title: "Tasks", problem: "Lost work.", audience: "Teams.", outcome: "Traceable work." },
        constitution: { id: "constitution", principles: ["Keep work traceable."] },
        architecture: { id: "architecture", overview: "A bounded system.", components: ["Planning boundary"] },
        roadmap: { id: "roadmap", milestones: ["Deliver planning"] },
        relationships: [
          { type: "DEPENDS_ON", sourceId: "architecture", targetId: "vision" },
          { type: "DEPENDS_ON", sourceId: "architecture", targetId: "constitution" },
          { type: "DEPENDS_ON", sourceId: "roadmap", targetId: "architecture" },
        ],
      },
      completedStages: ["foundation", "architecture", "roadmap"],
      nodes: [
        { id: "vision", type: "VISION" },
        { id: "constitution", type: "CONSTITUTION" },
        { id: "architecture", type: "ARCHITECTURE" },
        { id: "roadmap", type: "ROADMAP" },
      ],
      relationships: [
        { type: "DEPENDS_ON", sourceId: "architecture", targetId: "vision" },
        { type: "DEPENDS_ON", sourceId: "architecture", targetId: "constitution" },
        { type: "DEPENDS_ON", sourceId: "roadmap", targetId: "architecture" },
      ],
    }), "utf8")

    const planning = await createPlanningGraphRepository().loadPlanningState(workspace)

    expect(planning?.roadmap?.milestones).toEqual([{
      title: "Deliver planning",
      objective: "Complete the Deliver planning milestone.",
      outcomes: ["Deliver planning is complete."],
    }])
  })
})
