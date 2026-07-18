import { join } from "node:path"
import type {
  Architecture,
  ArchitectureDraft,
  AcceptanceCriterion,
  Constitution,
  Epic,
  EpicsDraft,
  PlanningArtifact,
  PlanningStage,
  PlanningState,
  PlanningArtifactSet,
  PlanningRelationship,
  Roadmap,
  RoadmapDraft,
  Story,
  Task,
  Vision,
  Workspace,
} from "@specta/core"
import {
  foundationDraftSchema,
  architectureDraftSchema,
  createPlanningId,
  epicsDraftSchema,
  roadmapDraftSchema,
  planningBriefSchema,
  planningStateSchema,
  SpectaError,
} from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { nodeFileSystem } from "@specta/core/filesystem"
import { createPlanningGraphRepository, type PlanningGraphRepository } from "@specta/graph"
import {
  renderArchitecture,
  renderConstitution,
  renderEpic,
  renderRoadmap,
  renderVision,
} from "./templates.ts"

export interface PlanningStateRepository {
  load(workspace: Workspace): Promise<PlanningState | null>
  save(
    workspace: Workspace,
    state: PlanningState,
    stage: PlanningStage,
    templates?: Partial<Record<PlanningArtifact["kind"], string>>,
  ): Promise<PlanningArtifactSet>
}

export interface PlanningStateGraphUpdater {
  apply(workspace: Workspace, state: PlanningState): Promise<void>
}

export class PlanningError extends SpectaError {
  public constructor(message: string, cause?: unknown) {
    super(message, "PLANNING_ERROR", cause)
    this.name = "PlanningError"
  }
}

/** Validates agent-authored Foundation JSON and assigns deterministic graph IDs. */
export function createFoundationPlanningState(brief: string, value: unknown): PlanningState {
  const normalizedBrief = parsePlanningValue(planningBriefSchema.safeParse(brief), "Invalid planning brief")
  const draft = parsePlanningValue(foundationDraftSchema.safeParse(value), "Invalid Foundation draft")
  const { title, problem, audience, outcome } = draft.vision
  const { principles } = draft.constitution
  const vision: Vision = {
    id: createPlanningId("vision", normalizedBrief + ":" + title),
    title,
    problem,
    audience,
    outcome,
  }
  const constitution: Constitution = {
    id: createPlanningId("constitution", normalizedBrief + ":" + title),
    principles,
  }
  const state: PlanningState = {
    brief: normalizedBrief,
    completedStages: ["foundation"],
    vision,
    constitution,
    relationships: [],
  }
  validatePlanningState(state)
  return state
}

/** Validates agent-authored Architecture JSON and extends the graph-owned Foundation state. */
export function createArchitecturePlanningState(
  current: PlanningState,
  value: unknown,
  guidance?: string,
): PlanningState {
  validatePlanningState(current)
  if (!current.completedStages.includes("foundation") || !current.vision || !current.constitution) {
    throw new PlanningError("Architecture planning requires a completed Foundation.")
  }
  if (current.completedStages.includes("architecture")) {
    throw new PlanningError("Architecture planning is already complete.")
  }
  const draft: ArchitectureDraft = parsePlanningValue(
    architectureDraftSchema.safeParse(value),
    "Invalid Architecture draft",
  )
  const architecture: Architecture = {
    id: createPlanningId(
      "architecture",
      JSON.stringify({ visionId: current.vision.id, draft, guidance: guidance?.trim() || undefined }),
    ),
    overview: draft.overview,
    components: draft.components,
    ...(guidance?.trim() ? { guidance: guidance.trim() } : {}),
  }
  const state: PlanningState = {
    ...current,
    completedStages: [...current.completedStages, "architecture"],
    architecture,
    relationships: uniqueRelationships([
      ...current.relationships,
      { type: "DEPENDS_ON", sourceId: architecture.id, targetId: current.vision.id },
      { type: "DEPENDS_ON", sourceId: architecture.id, targetId: current.constitution.id },
    ]),
  }
  validatePlanningState(state)
  return state
}

/** Validates agent-authored Roadmap JSON and extends the graph-owned Architecture state. */
export function createRoadmapPlanningState(current: PlanningState, value: unknown): PlanningState {
  validatePlanningState(current)
  if (
    !current.completedStages.includes("foundation")
    || !current.completedStages.includes("architecture")
    || !current.architecture
  ) {
    throw new PlanningError("Roadmap planning requires completed Foundation and Architecture stages.")
  }
  if (current.completedStages.includes("roadmap")) {
    throw new PlanningError("Roadmap planning is already complete.")
  }
  const draft: RoadmapDraft = parsePlanningValue(
    roadmapDraftSchema.safeParse(value),
    "Invalid Roadmap draft",
  )
  const roadmap: Roadmap = {
    id: createPlanningId("roadmap", JSON.stringify({ architectureId: current.architecture.id, draft })),
    milestones: draft.milestones,
  }
  const state: PlanningState = {
    ...current,
    completedStages: [...current.completedStages, "roadmap"],
    roadmap,
    relationships: uniqueRelationships([
      ...current.relationships,
      { type: "DEPENDS_ON", sourceId: roadmap.id, targetId: current.architecture.id },
    ]),
  }
  validatePlanningState(state)
  return state
}

/** Validates agent-authored Epics JSON and assigns deterministic nested graph metadata. */
export function createEpicsPlanningState(current: PlanningState, value: unknown): PlanningState {
  validatePlanningState(current)
  if (
    !current.completedStages.includes("roadmap")
    || !current.roadmap
    || !current.architecture
  ) {
    throw new PlanningError("Epics planning requires completed Foundation, Architecture and Roadmap stages.")
  }
  if (current.completedStages.includes("epics")) {
    throw new PlanningError("Epics planning is already complete.")
  }
  const draft: EpicsDraft = parsePlanningValue(epicsDraftSchema.safeParse(value), "Invalid Epics draft")
  const milestones = new Map(current.roadmap.milestones.map((milestone) => [milestone.title.toLowerCase(), milestone]))
  const referencedMilestones = new Set<string>()
  const epics = draft.epics.map((epicDraft): Epic => {
    const milestone = milestones.get(epicDraft.roadmapMilestone.toLowerCase())
    if (milestone === undefined) {
      throw new PlanningError("Epic " + epicDraft.title + " references an unknown Roadmap milestone.")
    }
    referencedMilestones.add(milestone.title.toLowerCase())
    const canonicalEpicDraft = { ...epicDraft, roadmapMilestone: milestone.title }
    const epicId = createPlanningId("epic", JSON.stringify({ roadmapId: current.roadmap!.id, epicDraft: canonicalEpicDraft }))
    return {
      id: epicId,
      title: epicDraft.title,
      goal: epicDraft.goal,
      roadmapMilestone: milestone.title,
      stories: epicDraft.stories.map((storyDraft): Story => {
        const storyId = createPlanningId("story", JSON.stringify({ epicId, storyDraft }))
        return {
          id: storyId,
          title: storyDraft.title,
          description: storyDraft.description,
          acceptanceCriteria: storyDraft.acceptanceCriteria.map((description): AcceptanceCriterion => ({
            id: createPlanningId("criterion", JSON.stringify({ storyId, description })),
            description,
          })),
          tasks: storyDraft.tasks.map((taskDraft): Task => ({
            id: createPlanningId("task", JSON.stringify({ storyId, taskDraft })),
            ...taskDraft,
          })),
        }
      }),
    }
  })
  const missingMilestones = current.roadmap.milestones
    .filter((milestone) => !referencedMilestones.has(milestone.title.toLowerCase()))
    .map((milestone) => milestone.title)
  if (missingMilestones.length > 0) {
    throw new PlanningError("Epics must cover every Roadmap milestone; missing: " + missingMilestones.join(", ") + ".")
  }
  const relationships: PlanningRelationship[] = epics.flatMap((epic) => [
    { type: "DEPENDS_ON" as const, sourceId: epic.id, targetId: current.roadmap!.id },
    { type: "IMPLEMENTS" as const, sourceId: epic.id, targetId: current.architecture!.id },
    ...epic.stories.flatMap((story) => [
      { type: "CONTAINS" as const, sourceId: epic.id, targetId: story.id },
      ...story.acceptanceCriteria.map((criterion) => ({
        type: "CONTAINS" as const,
        sourceId: story.id,
        targetId: criterion.id,
      })),
      ...story.tasks.map((task) => ({ type: "CONTAINS" as const, sourceId: story.id, targetId: task.id })),
    ]),
  ])
  const state: PlanningState = {
    ...current,
    completedStages: [...current.completedStages, "epics"],
    epics,
    relationships: uniqueRelationships([...current.relationships, ...relationships]),
  }
  validatePlanningState(state)
  return state
}

/** Persists incremental planning state and the Markdown artifacts produced by each stage. */
export function createPlanningStateRepository(
  fileSystem: FileSystem = nodeFileSystem,
  graph: PlanningGraphRepository = createPlanningGraphRepository(fileSystem),
): PlanningStateRepository {
  return {
    load: (workspace) => graph.loadPlanningState(workspace),
    async save(workspace, state, stage, templates = {}) {
      validatePlanningState(state)
      const documents = stageDocuments(state, stage)
      for (const document of documents) {
        const content = applyArtifactTemplate(templates[document.kind], document.content)
        await writeIfChanged(fileSystem, join(workspace.rootPath, document.path), content)
      }
      return {
        rootPath: ".specta/planning",
        documents: documents.map(({ kind, path }) => ({ kind, path })),
      }
    },
  }
}

/** Compiles every completed planning stage into the Workspace Graph. */
export function createPlanningStateGraphUpdater(
  graph: PlanningGraphRepository = createPlanningGraphRepository(),
): PlanningStateGraphUpdater {
  return {
    async apply(workspace, state) {
      validatePlanningState(state)
      await graph.savePlanningState(workspace, state)
    },
  }
}

function uniqueRelationships(relationships: PlanningRelationship[]): PlanningRelationship[] {
  const seen = new Set<string>()
  return relationships.filter((relationship) => {
    const key = relationship.type + ":" + relationship.sourceId + ":" + relationship.targetId
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function validatePlanningState(state: PlanningState): void {
  parsePlanningValue(planningStateSchema.safeParse(state), "Invalid planning state")
}

function stageDocuments(
  state: PlanningState,
  stage: PlanningStage,
): Array<PlanningArtifact & { content: string }> {
  if (stage === "foundation" && state.vision && state.constitution) {
    return [
      { kind: "vision", path: ".specta/planning/vision.md", content: renderVision(state.vision) },
      { kind: "constitution", path: ".specta/planning/constitution.md", content: renderConstitution(state.constitution) },
    ]
  }
  if (stage === "architecture" && state.architecture) {
    return [{ kind: "architecture", path: ".specta/planning/architecture.md", content: renderArchitecture(state.architecture) }]
  }
  if (stage === "roadmap" && state.roadmap) {
    return [{ kind: "roadmap", path: ".specta/planning/roadmap.md", content: renderRoadmap(state.roadmap) }]
  }
  if (stage === "epics" && state.epics) {
    return state.epics.map((epic, index) => ({
      kind: "epic" as const,
      path: ".specta/planning/epics/" + String(index + 1).padStart(3, "0") + "-" + slug(epic.title) + ".md",
      content: renderEpic(epic),
    }))
  }
  throw new PlanningError("Planning stage " + stage + " did not produce its required artifacts.")
}

/** Returns every artifact path owned by one planning-stage commit. */
export function planningStageArtifactPaths(state: PlanningState, stage: PlanningStage): string[] {
  return stageDocuments(state, stage).map((document) => document.path)
}

function applyArtifactTemplate(template: string | undefined, content: string): string {
  if (template === undefined) return content
  if (!template.includes("{{content}}")) throw new PlanningError("Artifact templates must include {{content}}.")
  return template.replace("{{content}}", content)
}

async function writeIfChanged(fileSystem: FileSystem, path: string, content: string): Promise<boolean> {
  if (await fileSystem.exists(path) && (await fileSystem.readText(path)) === content) return false
  await fileSystem.writeText(path, content)
  return true
}

function parsePlanningValue<T>(
  result: { success: true, data: T } | { success: false, error: { issues: Array<{ path: PropertyKey[], message: string }> } },
  label: string,
): T {
  if (result.success) return result.data
  const details = result.error.issues.map((issue) => {
    const path = issue.path.length === 0 ? "" : " at " + issue.path.join(".")
    return issue.message + path
  }).join("; ")
  throw new PlanningError(label + ": " + details)
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "epic"
}
