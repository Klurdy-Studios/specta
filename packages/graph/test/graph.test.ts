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
      "AcceptanceCriterion",
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
      schemaVersion: 3 as const,
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
    expect(() => planningGraphSnapshotSchema.parse({ ...snapshot, nodes: snapshot.nodes.slice(0, 1) }))
      .toThrow("Graph nodes must exactly match planning state")
    expect(() => planningGraphSnapshotSchema.parse({
      ...snapshot,
      nodes: [...snapshot.nodes, { id: "stale", type: "TASK" }],
    })).toThrow("Graph nodes must exactly match planning state")
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
      schemaVersion: 3,
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
      .resolves.toContain('"schemaVersion": 3')
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

    const repository = createPlanningGraphRepository()
    const planning = await repository.loadPlanningState(workspace)

    expect(planning?.roadmap?.milestones).toEqual([{
      title: "Deliver planning",
      objective: "Complete the Deliver planning milestone.",
      outcomes: ["Deliver planning is complete."],
    }])
  })

  it("migrates version 2 Epics and acceptance criteria", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "specta-v2-epics-"))
    temporaryDirectories.push(rootPath)
    const workspace: Workspace = {
      schemaVersion: 1,
      id: "ws_v2" as Workspace["id"],
      rootPath,
      createdAt: "2026-01-01T00:00:00.000Z",
      packageManager: "unknown",
      projects: [],
      artifacts: {},
      workflow: { skillTargets: [], manifestPath: ".specta/workflows/manifest.json" },
    }
    const relationships = [
      { type: "DEPENDS_ON", sourceId: "architecture", targetId: "vision" },
      { type: "DEPENDS_ON", sourceId: "architecture", targetId: "constitution" },
      { type: "DEPENDS_ON", sourceId: "roadmap", targetId: "architecture" },
      { type: "DEPENDS_ON", sourceId: "epic", targetId: "roadmap" },
      { type: "IMPLEMENTS", sourceId: "epic", targetId: "architecture" },
      { type: "CONTAINS", sourceId: "epic", targetId: "story" },
      { type: "CONTAINS", sourceId: "story", targetId: "task" },
    ]
    const path = join(rootPath, ".specta", "graph", "planning-relationships.json")
    await mkdir(join(rootPath, ".specta", "graph"), { recursive: true })
    await writeFile(path, JSON.stringify({
      schemaVersion: 2,
      planning: {
        brief: "Build planning.",
        completedStages: ["foundation", "architecture", "roadmap", "epics"],
        vision: { id: "vision", title: "Plan", problem: "No plan.", audience: "Teams.", outcome: "Planned work." },
        constitution: { id: "constitution", principles: ["Keep work traceable."] },
        architecture: { id: "architecture", overview: "A planning system.", components: ["Planning"] },
        roadmap: { id: "roadmap", milestones: [{ title: "MVP", objective: "Deliver planning.", outcomes: ["Planning works."] }] },
        epics: [{
          id: "epic",
          title: "MVP",
          goal: "Deliver planning.",
          stories: [{
            id: "story",
            title: "Create plans",
            description: "Teams create plans.",
            acceptanceCriteria: ["A plan is persisted."],
            tasks: [{ id: "task", title: "Persist plans", description: "Store the plan." }],
          }],
        }],
        relationships,
      },
      completedStages: ["foundation", "architecture", "roadmap", "epics"],
      nodes: [
        { id: "vision", type: "VISION" },
        { id: "constitution", type: "CONSTITUTION" },
        { id: "architecture", type: "ARCHITECTURE" },
        { id: "roadmap", type: "ROADMAP" },
        { id: "epic", type: "EPIC" },
        { id: "story", type: "STORY" },
        { id: "task", type: "TASK" },
      ],
      relationships,
    }), "utf8")

    const repository = createPlanningGraphRepository()
    const planning = await repository.loadPlanningState(workspace)

    expect(planning?.epics?.[0]?.roadmapMilestone).toBe("MVP")
    expect(planning?.epics?.[0]?.stories[0]?.acceptanceCriteria[0]).toMatchObject({
      id: expect.stringMatching(/^plan_/),
      description: "A plan is persisted.",
    })
    expect(planning?.relationships).toContainEqual({
      type: "CONTAINS",
      sourceId: "story",
      targetId: planning?.epics?.[0]?.stories[0]?.acceptanceCriteria[0]?.id,
    })
    await repository.savePlanningState(workspace, planning!)
    const migrated = JSON.parse(await readFile(path, "utf8"))
    expect(migrated.schemaVersion).toBe(3)
    expect(migrated.nodes.some((node: { type: string }) => node.type === "ACCEPTANCE_CRITERION")).toBe(true)

    migrated.planning.epics[0].stories[0].acceptanceCriteria = ["Legacy criterion in v3"]
    await writeFile(path, JSON.stringify(migrated), "utf8")
    await expect(repository.loadPlanningState(workspace)).rejects.toThrow("Unable to read planning state")

    migrated.schemaVersion = 99
    await writeFile(path, JSON.stringify(migrated), "utf8")
    await expect(repository.loadPlanningState(workspace)).rejects.toThrow("Unable to read planning state")
  })
})
