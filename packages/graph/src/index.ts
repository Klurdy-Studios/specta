import { defineEdge, defineGraph, defineNode } from "@nicia-ai/typegraph"
import { join } from "node:path"
import {
  acceptanceCriterionSchema,
  createPlanningId,
  architectureSchema,
  constitutionSchema,
  epicSchema,
  planningIdSchema,
  planningRelationshipSchema,
  planningStageSchema,
  planningStateDataSchema,
  planningStateSchema,
  projectProfileSchema,
  roadmapSchema,
  roadmapMilestoneSchema,
  storySchema,
  scaffoldPlanSchema,
  taskSchema,
  technicalDesignSchema,
  technicalFileSchema,
  technicalModuleSchema,
  technicalSymbolSchema,
  visionSchema,
  type PlanningState,
  type PlanningRelationship,
  type Workspace,
} from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { nodeFileSystem } from "@specta/core/filesystem"
import { z } from "zod"

export * from "./implementation.ts"
export * from "./analysis/index.ts"
export * from "./parser/index.ts"

export const VisionNode = defineNode("Vision", { schema: visionSchema.omit({ id: true }) })
export const ConstitutionNode = defineNode("Constitution", { schema: constitutionSchema.omit({ id: true }) })
export const ArchitectureNode = defineNode("Architecture", { schema: architectureSchema.omit({ id: true }) })
export const RoadmapNode = defineNode("Roadmap", { schema: roadmapSchema.omit({ id: true }) })
export const EpicNode = defineNode("Epic", { schema: epicSchema.omit({ id: true, stories: true }) })
export const StoryNode = defineNode("Story", { schema: storySchema.omit({ id: true, acceptanceCriteria: true, tasks: true }) })
export const AcceptanceCriterionNode = defineNode("AcceptanceCriterion", { schema: acceptanceCriterionSchema.omit({ id: true }) })
export const TaskNode = defineNode("Task", { schema: taskSchema.omit({ id: true }) })
export const TechnicalDesignNode = defineNode("TechnicalDesign", {
  schema: z.object({
    targetId: technicalDesignSchema.shape.targetId,
    target: technicalDesignSchema.shape.target,
    profile: technicalDesignSchema.shape.profile,
    status: technicalDesignSchema.shape.status,
    revision: technicalDesignSchema.shape.revision,
    summary: technicalDesignSchema.shape.summary,
    impactRequests: technicalDesignSchema.shape.impactRequests,
    feedback: technicalDesignSchema.shape.feedback,
    scaffoldedPaths: technicalDesignSchema.shape.scaffoldedPaths,
  }).strict(),
})
export const ModuleNode = defineNode("Module", {
  schema: technicalModuleSchema.omit({ files: true }),
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
export const ProjectProfileNode = defineNode("ProjectProfile", { schema: projectProfileSchema })
export const ScaffoldRunNode = defineNode("ScaffoldRun", {
  schema: scaffoldPlanSchema.omit({ id: true, expectedFiles: true, existingFiles: true }),
})
export const SpecificationDocumentNode = defineNode("SpecificationDocument", {
  schema: z.object({ path: z.string().min(1), title: z.string().min(1).optional() }).strict(),
})
export const RequirementNode = defineNode("Requirement", {
  schema: z.object({ title: z.string().min(1), path: z.string().min(1) }).strict(),
})
export const ArchitectureDecisionNode = defineNode("ArchitectureDecision", {
  schema: z.object({ title: z.string().min(1), path: z.string().min(1) }).strict(),
})
export const TestNode = defineNode("Test", {
  schema: z.object({ name: z.string().min(1), framework: z.string().min(1), path: z.string().min(1) }).strict(),
})
export const ExternalDependencyNode = defineNode("ExternalDependency", {
  schema: z.object({ name: z.string().min(1) }).strict(),
})

export const ContainsEdge = defineEdge("CONTAINS")
export const DependsOnEdge = defineEdge("DEPENDS_ON")
export const ImplementsEdge = defineEdge("IMPLEMENTS")
export const ImportsEdge = defineEdge("IMPORTS")
export const ExportsEdge = defineEdge("EXPORTS")
export const TestsEdge = defineEdge("TESTS")
export const ReferencesEdge = defineEdge("REFERENCES")

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
    AcceptanceCriterion: { type: AcceptanceCriterionNode },
    Task: { type: TaskNode },
    TechnicalDesign: { type: TechnicalDesignNode },
    Module: { type: ModuleNode },
    File: { type: FileNode },
    CodeSymbol: { type: CodeSymbolNode },
    ProjectProfile: { type: ProjectProfileNode },
    ScaffoldRun: { type: ScaffoldRunNode },
    SpecificationDocument: { type: SpecificationDocumentNode },
    Requirement: { type: RequirementNode },
    ArchitectureDecision: { type: ArchitectureDecisionNode },
    Test: { type: TestNode },
    ExternalDependency: { type: ExternalDependencyNode },
  },
  edges: {
    CONTAINS: {
      type: ContainsEdge,
      from: [EpicNode, StoryNode, TechnicalDesignNode, ModuleNode, FileNode, SpecificationDocumentNode],
      to: [StoryNode, AcceptanceCriterionNode, TaskNode, ModuleNode, FileNode, CodeSymbolNode, RequirementNode, ArchitectureDecisionNode, EpicNode, TestNode],
    },
    DEPENDS_ON: {
      type: DependsOnEdge,
      from: [ArchitectureNode, RoadmapNode, EpicNode, TechnicalDesignNode, ModuleNode],
      to: [VisionNode, ConstitutionNode, ArchitectureNode, RoadmapNode, TechnicalDesignNode, ModuleNode, ProjectProfileNode],
    },
    IMPLEMENTS: {
      type: ImplementsEdge,
      from: [EpicNode, TechnicalDesignNode, ModuleNode, FileNode, ScaffoldRunNode],
      to: [ArchitectureNode, EpicNode, TechnicalDesignNode, ModuleNode],
    },
    IMPORTS: {
      type: ImportsEdge,
      from: [FileNode],
      to: [FileNode, ExternalDependencyNode],
    },
    EXPORTS: {
      type: ExportsEdge,
      from: [FileNode],
      to: [CodeSymbolNode],
    },
    TESTS: {
      type: TestsEdge,
      from: [TestNode],
      to: [CodeSymbolNode, FileNode],
    },
    REFERENCES: {
      type: ReferencesEdge,
      from: [SpecificationDocumentNode, RequirementNode, ArchitectureDecisionNode, EpicNode, StoryNode, FileNode, CodeSymbolNode],
      to: [SpecificationDocumentNode, RequirementNode, ArchitectureDecisionNode, EpicNode, StoryNode, FileNode, CodeSymbolNode],
    },
  },
})

export const planningGraphNodeSchema = z.object({
  id: planningIdSchema,
  type: z.enum(["VISION", "CONSTITUTION", "ARCHITECTURE", "ROADMAP", "EPIC", "STORY", "ACCEPTANCE_CRITERION", "TASK"]),
}).strict()
export type PlanningGraphNode = z.infer<typeof planningGraphNodeSchema>

/** Serializable graph snapshot used until the TypeGraph persistence backend is introduced. */
export const planningGraphSnapshotSchema = z.object({
  schemaVersion: z.literal(3),
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
  const expectedNodes = planningNodes(snapshot.planning).map(graphNodeKey)
  const actualNodes = snapshot.nodes.map(graphNodeKey)
  const actualNodeSet = new Set(actualNodes)
  if (
    actualNodeSet.size !== actualNodes.length
    || expectedNodes.length !== actualNodes.length
    || expectedNodes.some((node) => !actualNodeSet.has(node))
  ) {
    context.addIssue({ code: "custom", message: "Graph nodes must exactly match planning state.", path: ["nodes"] })
  }
})
export type PlanningGraphSnapshot = z.infer<typeof planningGraphSnapshotSchema>

const persistedRoadmapSchema = z.object({
  id: planningIdSchema,
  milestones: z.array(z.union([z.string().trim().min(1), roadmapMilestoneSchema])).min(1),
}).strict()

const persistedAcceptanceCriterionSchema = z.union([z.string().trim().min(1), acceptanceCriterionSchema])
const persistedStorySchema = z.object({
  id: planningIdSchema,
  title: storySchema.shape.title,
  description: storySchema.shape.description,
  acceptanceCriteria: z.array(persistedAcceptanceCriterionSchema).min(1),
  tasks: storySchema.shape.tasks,
}).strict()
const persistedEpicSchema = z.object({
  id: planningIdSchema,
  title: epicSchema.shape.title,
  goal: epicSchema.shape.goal,
  roadmapMilestone: epicSchema.shape.roadmapMilestone.optional(),
  stories: z.array(persistedStorySchema).min(1),
}).strict()

const persistedPlanningStateSchema = planningStateDataSchema.omit({ roadmap: true, epics: true }).extend({
  roadmap: persistedRoadmapSchema.optional(),
  epics: z.array(persistedEpicSchema).min(1).optional(),
}).strict()

const legacyPlanningGraphSnapshotSchema = z.object({
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
        return parsePlanningGraphSnapshot(JSON.parse(await fileSystem.readText(path))).planning
      } catch (error) {
        throw new Error("Unable to read planning state from the Workspace Graph.", { cause: error })
      }
    },
    async savePlanningState(workspace, state) {
      const snapshot = planningGraphSnapshotSchema.parse({
        schemaVersion: 3,
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

function parsePlanningGraphSnapshot(value: unknown): PlanningGraphSnapshot {
  const envelope = z.object({ schemaVersion: z.unknown().optional() }).passthrough().parse(value)
  if (envelope.schemaVersion === 3) return planningGraphSnapshotSchema.parse(value)
  if (envelope.schemaVersion === undefined || envelope.schemaVersion === 2) return migratePlanningGraphSnapshot(value)
  throw new Error("Unsupported planning graph schema version: " + String(envelope.schemaVersion) + ".")
}

function migratePlanningGraphSnapshot(value: unknown): PlanningGraphSnapshot {
  const persisted = legacyPlanningGraphSnapshotSchema.parse(value)
  if (JSON.stringify(persisted.completedStages) !== JSON.stringify(persisted.planning.completedStages)) {
    throw new Error("Graph completed stages must match planning state.")
  }
  if (JSON.stringify(persisted.relationships) !== JSON.stringify(persisted.planning.relationships)) {
    throw new Error("Graph relationships must match planning state.")
  }
  const roadmap = persisted.planning.roadmap
  const migratedRoadmap = roadmap === undefined ? undefined : {
    id: roadmap.id,
    milestones: roadmap.milestones.map((milestone) => typeof milestone === "string"
      ? {
          title: milestone,
          objective: "Complete the " + milestone + " milestone.",
          outcomes: [milestone + " is complete."],
        }
      : milestone),
  }
  const migratedRelationships: PlanningRelationship[] = [...persisted.relationships]
  const migratedNodes: PlanningGraphNode[] = [...persisted.nodes]
  const relationshipKeys = new Set(migratedRelationships.map(relationshipKey))
  const nodeIds = new Set(migratedNodes.map((node) => node.id))
  const migratedEpics = persisted.planning.epics?.map((epic) => {
    const migratedEpic = {
      id: epic.id,
      title: epic.title,
      goal: epic.goal,
      roadmapMilestone: epic.roadmapMilestone
        ?? migratedRoadmap?.milestones.find((milestone) => milestone.title.toLowerCase() === epic.title.toLowerCase())?.title
        ?? migratedRoadmap?.milestones[0]?.title
        ?? epic.title,
      stories: epic.stories.map((story) => ({
        ...story,
        acceptanceCriteria: story.acceptanceCriteria.map((criterion, index) => {
          if (typeof criterion !== "string") return criterion
          const id = createPlanningId("criterion", JSON.stringify({ storyId: story.id, criterion, index }))
          if (!nodeIds.has(id)) {
            migratedNodes.push({ id, type: "ACCEPTANCE_CRITERION" })
            nodeIds.add(id)
          }
          return { id, description: criterion }
        }),
      })),
    }
    if (migratedRoadmap) appendRelationship(migratedRelationships, relationshipKeys, { type: "DEPENDS_ON", sourceId: epic.id, targetId: migratedRoadmap.id })
    if (persisted.planning.architecture) {
      appendRelationship(migratedRelationships, relationshipKeys, { type: "IMPLEMENTS", sourceId: epic.id, targetId: persisted.planning.architecture.id })
    }
    for (const story of migratedEpic.stories) {
      appendRelationship(migratedRelationships, relationshipKeys, { type: "CONTAINS", sourceId: epic.id, targetId: story.id })
      for (const criterion of story.acceptanceCriteria) {
        appendRelationship(migratedRelationships, relationshipKeys, { type: "CONTAINS", sourceId: story.id, targetId: criterion.id })
      }
      for (const task of story.tasks) {
        appendRelationship(migratedRelationships, relationshipKeys, { type: "CONTAINS", sourceId: story.id, targetId: task.id })
      }
    }
    return migratedEpic
  })
  const planning = {
    ...persisted.planning,
    ...(migratedRoadmap === undefined ? {} : { roadmap: migratedRoadmap }),
    ...(migratedEpics === undefined ? {} : { epics: migratedEpics }),
    relationships: migratedRelationships,
  }
  return planningGraphSnapshotSchema.parse({
    schemaVersion: 3,
    planning,
    completedStages: persisted.completedStages,
    nodes: migratedNodes,
    relationships: migratedRelationships,
  })
}

function relationshipKey(relationship: PlanningRelationship): string {
  return relationship.type + ":" + relationship.sourceId + ":" + relationship.targetId
}

function appendRelationship(
  relationships: PlanningRelationship[],
  keys: Set<string>,
  candidate: PlanningRelationship,
): void {
  const key = relationshipKey(candidate)
  if (!keys.has(key)) {
    relationships.push(candidate)
    keys.add(key)
  }
}

function graphNodeKey(node: PlanningGraphNode): string {
  return node.type + ":" + node.id
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
        ...story.acceptanceCriteria.map((criterion) => ({ id: criterion.id, type: "ACCEPTANCE_CRITERION" as const })),
        ...story.tasks.map((task) => ({ id: task.id, type: "TASK" as const })),
      ]),
    ]),
  ]
}
