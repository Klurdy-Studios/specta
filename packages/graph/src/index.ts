import { defineEdge, defineGraph, defineNode } from "@nicia-ai/typegraph"
import {
  architectureSchema,
  constitutionSchema,
  epicSchema,
  planningIdSchema,
  planningRelationshipSchema,
  planningStageSchema,
  planningStateSchema,
  roadmapSchema,
  storySchema,
  taskSchema,
  technicalDesignSchema,
  technicalFileSchema,
  technicalModuleSchema,
  technicalSymbolSchema,
  visionSchema,
} from "@specta/core"
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

/** Serializable graph snapshot used until the TypeGraph persistence backend is introduced. */
export const planningGraphSnapshotSchema = z.object({
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
