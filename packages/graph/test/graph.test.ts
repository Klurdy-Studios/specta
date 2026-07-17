import { getEdgeKinds, getNodeKinds } from "@nicia-ai/typegraph"
import { describe, expect, it } from "vitest"
import { planningGraphSnapshotSchema, workspaceGraph } from "../src/index.js"

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
})
