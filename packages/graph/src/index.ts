import { defineEdge, defineGraph, defineNode } from "@nicia-ai/typegraph"
import { join } from "node:path"
import {
  architectureSchema,
  constitutionSchema,
  epicSchema,
  planningIdSchema,
  planningRelationshipSchema,
  planningStageSchema,
  planningStateDataSchema,
  planningStateSchema,
  roadmapSchema,
  roadmapMilestoneSchema,
  storySchema,
  taskSchema,
  technicalDesignSchema,
  technicalFileSchema,
  technicalModuleSchema,
  technicalSymbolSchema,
  visionSchema,
  type PlanningState,
  type Workspace,
} from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { nodeFileSystem } from "@specta/core/filesystem"
import { z } from "zod"

export const VisionNode = defineNode("Vision", { schema: visionSchema.omit({ id: true }) })
export const ConstitutionNode = defineNode("Constitution", { schema: constitutionSchema.omit({ id: true }) })
export const ArchitectureNode = defineNode("Architecture", { schema: architectureSchema.omit({ id: true }) })
export const RoadmapNode = defineNode("Roadmap", { schema: roadmapSchema.omit({ id: true }) })
export const EpicNode = defineNode("Epic", { schema: epicSchema.omit({ id: true, stories: true }) })
export const StoryNode = defineNode("Story", { schema: storySchema.omit({ id: true, tasks: true }) })
export const TaskNode = defineNode("Task", { schema: taskSchema.omit({ id: true }) })
export const TechnicalDesignNode = defineNode("TechnicalDesign", {
  schema: z.object({
    targetId: technicalDesignSchema.shape.targetId,
    status: technicalDesignSchema.shape.status,
    revision: technicalDesignSchema.shape.revision,
    summary: technicalDesignSchema.shape.summary,
    impactRequests: technicalDesignSchema.shape.impactRequests,
    feedback: technicalDesignSchema.shape.feedback,
    scaffoldedPaths: technicalDesignSchema.shape.scaffoldedPaths,
  }).strict(),
})
export const ModuleNode = defineNode("Module", {
  schema: technicalModuleSchema.omit({ files: true, dependencies: true }),
})
export const FileNode = defineNode("File", {
  schema: z.object({
    path: technicalFileSchema.shape.path,
    fileKind: technicalFileSchema.shape.kind,
  }).strict(),
})
export const CodeSymbolNode = defineNode("CodeSymbol", {
  schema: z.object({
    name: technicalSymbolSchema.shape.name,
    symbolKind: technicalSymbolSchema.shape.kind,
    signature: technicalSymbolSchema.shape.signature,
    purpose: technicalSymbolSchema.shape.purpose,
  }).strict(),
})

export const ContainsEdge = defineEdge("CONTAINS")
export const DependsOnEdge = defineEdge("DEPENDS_ON")
export const ImplementsEdge = defineEdge("IMPLEMENTS")

/** TypeGraph ontology for Specta's currently implemented planning and design entities. */
export const workspaceGraph = defineGraph({
  id: "specta_workspace",
  nodes: {
    Vision: { type: VisionNode },
    Constitution: { type: ConstitutionNode },
    Architecture: { type: ArchitectureNode },
    Roadmap: { type: RoadmapNode },
    Epic: { type: EpicNode },
    Story: { type: StoryNode },
    Task: { type: TaskNode },
    TechnicalDesign: { type: TechnicalDesignNode },
    Module: { type: ModuleNode },
    File: { type: FileNode },
    CodeSymbol: { type: CodeSymbolNode },
  },
  edges: {
    CONTAINS: {
      type: ContainsEdge,
      from: [EpicNode, StoryNode, TechnicalDesignNode, ModuleNode, FileNode],
      to: [StoryNode, TaskNode, ModuleNode, FileNode, CodeSymbolNode],
    },
    DEPENDS_ON: {
      type: DependsOnEdge,
      from: [ArchitectureNode, RoadmapNode, EpicNode, TechnicalDesignNode, ModuleNode],
      to: [VisionNode, ConstitutionNode, ArchitectureNode, RoadmapNode, TechnicalDesignNode, ModuleNode],
    },
    IMPLEMENTS: {
      type: ImplementsEdge,
      from: [EpicNode, TechnicalDesignNode, ModuleNode, FileNode],
      to: [ArchitectureNode, EpicNode, TechnicalDesignNode, ModuleNode],
    },
  },
})

export const planningGraphNodeSchema = z.object({
  id: planningIdSchema,
  type: z.enum(["VISION", "CONSTITUTION", "ARCHITECTURE", "ROADMAP", "EPIC", "STORY", "TASK"]),
}).strict()
export type PlanningGraphNode = z.infer<typeof planningGraphNodeSchema>

/** Serializable graph snapshot used until the TypeGraph persistence backend is introduced. */
export const planningGraphSnapshotSchema = z.object({
  schemaVersion: z.literal(2),
  planning: planningStateSchema,
  completedStages: z.array(planningStageSchema),
  nodes: z.array(planningGraphNodeSchema),
  relationships: z.array(planningRelationshipSchema),
}).strict().superRefine((snapshot, context) => {
  if (JSON.stringify(snapshot.completedStages) !== JSON.stringify(snapshot.planning.completedStages)) {
    context.addIssue({ code: "custom", message: "Graph completed stages must match planning state.", path: ["completedStages"] })
  }
  if (JSON.stringify(snapshot.relationships) !== JSON.stringify(snapshot.planning.relationships)) {
    context.addIssue({ code: "custom", message: "Graph relationships must match planning state.", path: ["relationships"] })
  }
})
export type PlanningGraphSnapshot = z.infer<typeof planningGraphSnapshotSchema>

const persistedRoadmapSchema = z.object({
  id: planningIdSchema,
  milestones: z.array(z.union([z.string().trim().min(1), roadmapMilestoneSchema])).min(1),
}).strict()

const persistedPlanningStateSchema = planningStateDataSchema.omit({ roadmap: true }).extend({
  roadmap: persistedRoadmapSchema.optional(),
}).strict()

const persistedPlanningGraphSnapshotSchema = z.object({
  schemaVersion: z.literal(2).optional(),
  planning: persistedPlanningStateSchema,
  completedStages: z.array(planningStageSchema),
  nodes: z.array(planningGraphNodeSchema),
  relationships: z.array(planningRelationshipSchema),
}).strict()

export interface PlanningGraphRepository {
  loadPlanningState(workspace: Workspace): Promise<PlanningState | null>
  savePlanningState(workspace: Workspace, state: PlanningState): Promise<void>
}

/** Reads validated planning state from the Workspace Graph. */
export function createPlanningGraphRepository(
  fileSystem: FileSystem = nodeFileSystem,
): PlanningGraphRepository {
  return {
    async loadPlanningState(workspace) {
      const path = join(workspace.rootPath, ".specta", "graph", "planning-relationships.json")
      if (!(await fileSystem.exists(path))) return null
      try {
        return migratePlanningGraphSnapshot(JSON.parse(await fileSystem.readText(path))).planning
      } catch (error) {
        throw new Error("Unable to read planning state from the Workspace Graph.", { cause: error })
      }
    },
    async savePlanningState(workspace, state) {
      const snapshot = planningGraphSnapshotSchema.parse({
        schemaVersion: 2,
        planning: state,
        completedStages: state.completedStages,
        nodes: planningNodes(state),
        relationships: state.relationships,
      })
      const path = join(workspace.rootPath, ".specta", "graph", "planning-relationships.json")
      const content = JSON.stringify(snapshot, null, 2) + "\n"
      if (!(await fileSystem.exists(path)) || await fileSystem.readText(path) !== content) {
        await fileSystem.writeText(path, content)
      }
    },
  }
}

function migratePlanningGraphSnapshot(value: unknown): PlanningGraphSnapshot {
  const persisted = persistedPlanningGraphSnapshotSchema.parse(value)
  const roadmap = persisted.planning.roadmap
  const planning = {
    ...persisted.planning,
    ...(roadmap === undefined ? {} : {
      roadmap: {
        id: roadmap.id,
        milestones: roadmap.milestones.map((milestone) => typeof milestone === "string"
          ? {
              title: milestone,
              objective: "Complete the " + milestone + " milestone.",
              outcomes: [milestone + " is complete."],
            }
          : milestone),
      },
    }),
  }
  return planningGraphSnapshotSchema.parse({
    schemaVersion: 2,
    planning,
    completedStages: persisted.completedStages,
    nodes: persisted.nodes,
    relationships: persisted.relationships,
  })
}

function planningNodes(state: PlanningState): PlanningGraphNode[] {
  return [
    ...(state.vision ? [{ id: state.vision.id, type: "VISION" as const }] : []),
    ...(state.constitution ? [{ id: state.constitution.id, type: "CONSTITUTION" as const }] : []),
    ...(state.architecture ? [{ id: state.architecture.id, type: "ARCHITECTURE" as const }] : []),
    ...(state.roadmap ? [{ id: state.roadmap.id, type: "ROADMAP" as const }] : []),
    ...(state.epics ?? []).flatMap((epic) => [
      { id: epic.id, type: "EPIC" as const },
      ...epic.stories.flatMap((story) => [
        { id: story.id, type: "STORY" as const },
        ...story.tasks.map((task) => ({ id: task.id, type: "TASK" as const })),
      ]),
    ]),
  ]
}
