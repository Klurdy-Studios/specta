import { getEdgeKinds, getNodeKinds } from "@nicia-ai/typegraph"
import { mkdtemp, rm } from "node:fs/promises"
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
  })
})
