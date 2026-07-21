import {
  acceptanceCriterionSchema,
  createPlanningId,
  epicSchema,
  planningIdSchema,
  planningRelationshipSchema,
  planningStageSchema,
  planningStateDataSchema,
  planningStateSchema,
  roadmapMilestoneSchema,
  storySchema,
  type PlanningState,
  type PlanningRelationship,
} from "@specta/core"
import { z } from "zod"

export const planningGraphNodeSchema = z.object({
  id: planningIdSchema,
  type: z.enum(["VISION", "CONSTITUTION", "ARCHITECTURE", "ROADMAP", "EPIC", "STORY", "ACCEPTANCE_CRITERION", "TASK"]),
}).strict()
export type PlanningGraphNode = z.infer<typeof planningGraphNodeSchema>

/** Validated legacy planning snapshot accepted by one-time SQLite import. */
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

/** Parses and migrates a persisted planning graph snapshot. */
export function parsePlanningGraphSnapshot(value: unknown): PlanningGraphSnapshot {
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
