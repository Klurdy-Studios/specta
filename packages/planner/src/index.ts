import { createHash } from "node:crypto"
import { join } from "node:path"
import type {
  Architecture,
  Constitution,
  Epic,
  FoundationDraft,
  PlanningArtifact,
  PlanningStage,
  PlanningState,
  PlanningArtifactSet,
  PlanningId,
  PlanningRelationship,
  ProjectPlan,
  Roadmap,
  Story,
  Task,
  Vision,
  Workspace,
} from "@specta/core"
import {
  foundationDraftSchema,
  planningBriefSchema,
  planningStateSchema,
  projectPlanSchema,
  SpectaError,
} from "@specta/core"
import type { FileSystem } from "@specta/filesystem"
import { nodeFileSystem } from "@specta/filesystem"
import { planningGraphSnapshotSchema } from "@specta/graph"
import {
  renderArchitecture,
  renderConstitution,
  renderEpic,
  renderRoadmap,
  renderVision,
} from "./templates.ts"

export interface PlanningRequest {
  workspace: Workspace
  brief: string
  context?: PlanningState
  prompt?: string
}

export interface PlanningDraft {
  title: string
  problem: string
  audience: string
  outcome: string
}

export interface PlanningProvider {
  generate(request: PlanningRequest): Promise<PlanningDraft>
}

export interface PlanningValidator {
  validate(plan: ProjectPlan): void
}

export interface PlanningArtifactRepository {
  load(workspace: Workspace): Promise<ProjectPlan | null>
  save(workspace: Workspace, plan: ProjectPlan): Promise<PlanningArtifactSet>
}

export interface PlanningGraphUpdater {
  apply(workspace: Workspace, relationships: PlanningRelationship[]): Promise<void>
}

export interface ProgressivePlanningRequest {
  workspace: Workspace
  stage: PlanningStage
  brief?: string
  state: PlanningState | null
  prompt?: string
}

export interface ProgressivePlanner {
  generate(request: ProgressivePlanningRequest): Promise<PlanningState>
  validate(state: PlanningState): void
}

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

export interface Planner {
  createPlan(request: PlanningRequest): Promise<ProjectPlan>
  validate(plan: ProjectPlan): void
}

export class PlanningError extends SpectaError {
  public constructor(message: string, cause?: unknown) {
    super(message, "PLANNING_ERROR", cause)
    this.name = "PlanningError"
  }
}

export function createDeterministicPlanningProvider(): PlanningProvider {
  return {
    async generate({ brief, workspace }) {
      const normalized = brief.trim().replace(/\s+/g, " ")
      if (normalized.length === 0) throw new PlanningError("A planning brief is required.")
      const title = sentenceTitle(normalized)
      const focus = extractFocus(normalized)
      return {
        title,
        problem: normalized,
        audience: "Developers working in " + workspace.rootPath,
        outcome: "A validated, traceable implementation plan for " + focus + ".",
      }
    },
  }
}

export function createPlanner(
  provider: PlanningProvider = createDeterministicPlanningProvider(),
  validator: PlanningValidator = createPlanningValidator(),
): Planner {
  return {
    async createPlan(request) {
      const draft = await provider.generate(request)
      const plan = materializePlan(draft)
      validator.validate(plan)
      return plan
    },
    validate: (plan) => validator.validate(plan),
  }
}

/** Creates deterministic, dependency-aware generators for individual planning stages. */
export function createProgressivePlanner(
  provider: PlanningProvider = createDeterministicPlanningProvider(),
): ProgressivePlanner {
  return {
    async generate({ workspace, stage, brief, state, prompt }) {
      if (stage === "foundation") {
        const draft = await provider.generate({ workspace, brief: brief ?? "", ...(prompt === undefined ? {} : { prompt }) })
        const plan = materializePlan(draft)
        const foundation: FoundationDraft = {
          vision: {
            title: plan.vision.title,
            problem: plan.vision.problem,
            audience: plan.vision.audience,
            outcome: plan.vision.outcome,
          },
          constitution: { principles: plan.constitution.principles },
        }
        return createFoundationPlanningState(draft.problem, foundation)
      }

      if (state === null) throw new PlanningError("Foundation planning must be completed before " + stage + ".")
      assertStagePrerequisites(state, stage)
      const draft = await provider.generate({ workspace, brief: state.brief, context: state, ...(prompt === undefined ? {} : { prompt }) })
      const generated = materializeStage(draft, state, stage)
      const next: PlanningState = {
        ...state,
        completedStages: [...state.completedStages, stage],
        ...(generated.architecture ? { architecture: generated.architecture } : {}),
        ...(generated.roadmap ? { roadmap: generated.roadmap } : {}),
        ...(generated.epics ? { epics: generated.epics } : {}),
        relationships: uniqueRelationships([...state.relationships, ...generated.relationships]),
      }
      validatePlanningState(next)
      return next
    },
    validate: validatePlanningState,
  }
}

/** Validates agent-authored Foundation JSON and assigns deterministic graph IDs. */
export function createFoundationPlanningState(brief: string, value: unknown): PlanningState {
  const normalizedBrief = parsePlanningValue(planningBriefSchema.safeParse(brief), "Invalid planning brief")
  const draft = parsePlanningValue(foundationDraftSchema.safeParse(value), "Invalid Foundation draft")
  const { title, problem, audience, outcome } = draft.vision
  const { principles } = draft.constitution
  const vision: Vision = {
    id: planningId("vision", normalizedBrief + ":" + title),
    title,
    problem,
    audience,
    outcome,
  }
  const constitution: Constitution = {
    id: planningId("constitution", normalizedBrief + ":" + title),
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

export function createPlanningValidator(): PlanningValidator {
  return {
    validate(plan) {
      parsePlanningValue(projectPlanSchema.safeParse(plan), "Invalid project plan")
    },
  }
}

export function createPlanningArtifactRepository(
  fileSystem: FileSystem = nodeFileSystem,
): PlanningArtifactRepository {
  return {
    async load(workspace) {
      const planPath = join(workspace.rootPath, ".specta", "planning", "plan.json")
      if (!(await fileSystem.exists(planPath))) return null
      try {
        return projectPlanSchema.parse(JSON.parse(await fileSystem.readText(planPath)))
      } catch (error) {
        throw new PlanningError("Unable to read the persisted project plan.", error)
      }
    },
    async save(workspace, plan) {
      const rootPath = join(workspace.rootPath, ".specta", "planning")
      const documents = [
        { kind: "vision" as const, path: ".specta/planning/vision.md", content: renderVision(plan.vision) },
        { kind: "constitution" as const, path: ".specta/planning/constitution.md", content: renderConstitution(plan.constitution) },
        { kind: "architecture" as const, path: ".specta/planning/architecture.md", content: renderArchitecture(plan.architecture) },
        { kind: "roadmap" as const, path: ".specta/planning/roadmap.md", content: renderRoadmap(plan.roadmap) },
        ...plan.epics.map((epic, index) => ({
          kind: "epic" as const,
          path: ".specta/planning/epics/" + String(index + 1).padStart(3, "0") + "-" + slug(epic.title) + ".md",
          content: renderEpic(epic),
        })),
      ]
      for (const document of documents) {
        await writeIfChanged(fileSystem, join(workspace.rootPath, document.path), document.content)
      }
      await writeIfChanged(fileSystem, join(rootPath, "plan.json"), JSON.stringify(plan, null, 2) + "\n")
      return { rootPath: ".specta/planning", documents: documents.map(({ kind, path }) => ({ kind, path })) }
    },
  }
}

/** Persists incremental planning state and the Markdown artifacts produced by each stage. */
export function createPlanningStateRepository(
  fileSystem: FileSystem = nodeFileSystem,
): PlanningStateRepository {
  return {
    async load(workspace) {
      const graphPath = join(workspace.rootPath, ".specta", "graph", "planning-relationships.json")
      if (!(await fileSystem.exists(graphPath))) return null
      try {
        return planningGraphSnapshotSchema.parse(JSON.parse(await fileSystem.readText(graphPath))).planning
      } catch (error) {
        throw new PlanningError("Unable to read planning state from the Workspace Graph.", error)
      }
    },
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
  fileSystem: FileSystem = nodeFileSystem,
): PlanningStateGraphUpdater {
  return {
    async apply(workspace, state) {
      validatePlanningState(state)
      const nodes = stateNodes(state).map((node) => ({ id: node.id, type: nodeType(node) }))
      const snapshot = planningGraphSnapshotSchema.parse({
        planning: state,
        completedStages: state.completedStages,
        nodes,
        relationships: state.relationships,
      })
      await writeIfChanged(
        fileSystem,
        join(workspace.rootPath, ".specta", "graph", "planning-relationships.json"),
        JSON.stringify(snapshot, null, 2) + "\n",
      )
    },
  }
}

export function createPlanningGraphUpdater(fileSystem: FileSystem = nodeFileSystem): PlanningGraphUpdater {
  return {
    async apply(workspace, relationships) {
      const graphPath = join(workspace.rootPath, ".specta", "graph", "planning-relationships.json")
      const planPath = join(workspace.rootPath, ".specta", "planning", "plan.json")
      const nodes = await graphNodes(fileSystem, planPath, relationships)
      await writeIfChanged(fileSystem, graphPath, JSON.stringify({ nodes, relationships }, null, 2) + "\n")
    },
  }
}

function materializePlan(draft: PlanningDraft): ProjectPlan {
  const vision: Vision = {
    id: planningId("vision", draft.title),
    title: draft.title,
    problem: draft.problem,
    audience: draft.audience,
    outcome: draft.outcome,
  }
  const focus = extractFocus(draft.problem)
  const constitution: Constitution = {
    id: planningId("constitution", draft.title),
    principles: [
      "Keep " + focus + " traceable from epic to task.",
      "Use the Workspace Graph as the source of truth.",
      "Validate outcomes before workflow completion.",
    ],
  }
  const architecture: Architecture = {
    id: planningId("architecture", draft.title),
    overview: focus + " is organized around planning, context, validation and traceable delivery.",
    components: componentsFor(draft.problem),
  }
  const roadmap: Roadmap = {
    id: planningId("roadmap", draft.title),
    milestones: ["Define " + focus, "Plan delivery for " + focus, "Implement and validate " + focus],
  }
  const task: Task = {
    id: planningId("task", draft.title),
    title: "Define the implementation approach for " + focus,
    description: "Translate the approved " + focus + " plan into an implementation-ready design.",
  }
  const story: Story = {
    id: planningId("story", draft.title),
    title: "Establish " + focus,
    description: "As a developer, I need a clear plan for " + focus + ".",
    acceptanceCriteria: [
      "The intended outcome for " + focus + " is documented.",
      "Implementation work for " + focus + " is traceable to the plan.",
    ],
    tasks: [task],
  }
  const epic: Epic = {
    id: planningId("epic", draft.title),
    title: draft.title,
    goal: draft.outcome,
    stories: [story],
  }
  const relationships: PlanningRelationship[] = [
    { type: "DEPENDS_ON", sourceId: epic.id, targetId: vision.id },
    { type: "DEPENDS_ON", sourceId: epic.id, targetId: constitution.id },
    { type: "DEPENDS_ON", sourceId: epic.id, targetId: roadmap.id },
    { type: "CONTAINS", sourceId: epic.id, targetId: story.id },
    { type: "CONTAINS", sourceId: story.id, targetId: task.id },
    { type: "IMPLEMENTS", sourceId: epic.id, targetId: architecture.id },
  ]
  return { vision, constitution, architecture, roadmap, epics: [epic], relationships }
}

function materializeStage(
  draft: PlanningDraft,
  state: PlanningState,
  stage: Exclude<PlanningStage, "foundation">,
): { architecture?: Architecture, roadmap?: Roadmap, epics?: Epic[], relationships: PlanningRelationship[] } {
  const fullPlan = materializePlan(draft)
  if (stage === "architecture") {
    const architecture: Architecture = {
      ...fullPlan.architecture,
      overview: state.vision!.outcome + " Architecture follows the Constitution: " + state.constitution!.principles[0],
    }
    return {
      architecture,
      relationships: [
        { type: "DEPENDS_ON", sourceId: architecture.id, targetId: state.vision!.id },
        { type: "DEPENDS_ON", sourceId: architecture.id, targetId: state.constitution!.id },
      ],
    }
  }
  if (stage === "roadmap") {
    const roadmap: Roadmap = {
      ...fullPlan.roadmap,
      milestones: state.architecture!.components.map((component) => "Deliver " + component),
    }
    return {
      roadmap,
      relationships: [{ type: "DEPENDS_ON", sourceId: roadmap.id, targetId: state.architecture!.id }],
    }
  }
  const epic: Epic = {
    ...fullPlan.epics[0]!,
    title: state.roadmap!.milestones[0]!,
    goal: state.vision!.outcome,
  }
  const stories = epic.stories
  const relationships: PlanningRelationship[] = [
    { type: "DEPENDS_ON", sourceId: epic.id, targetId: state.vision!.id },
    { type: "DEPENDS_ON", sourceId: epic.id, targetId: state.constitution!.id },
    { type: "DEPENDS_ON", sourceId: epic.id, targetId: state.roadmap!.id },
    { type: "IMPLEMENTS", sourceId: epic.id, targetId: state.architecture!.id },
    { type: "CONTAINS", sourceId: epic.id, targetId: stories[0]!.id },
    { type: "CONTAINS", sourceId: stories[0]!.id, targetId: stories[0]!.tasks[0]!.id },
  ]
  return { epics: [epic], relationships }
}

function planningId(kind: string, value: string): PlanningId {
  return ("plan_" + createHash("sha256").update(kind + ":" + value).digest("hex").slice(0, 16)) as PlanningId
}

function sentenceTitle(value: string): string {
  const title = value.split(/[.!?]/)[0]?.trim() || value
  return title.charAt(0).toUpperCase() + title.slice(1)
}

function extractFocus(value: string): string {
  return value.replace(/^build\s+/i, "").replace(/^create\s+/i, "").replace(/^plan\s+/i, "").replace(/[.!?].*$/, "").trim() || value
}

function componentsFor(value: string): string[] {
  const normalized = value.toLowerCase()
  const components = ["Workspace Graph", "Workflow Engine", "Planning artifacts"]
  if (normalized.includes("authentication") || normalized.includes("auth")) components.push("Authentication boundary")
  if (normalized.includes("api")) components.push("API boundary")
  if (normalized.includes("web") || normalized.includes("frontend")) components.push("User interface")
  return components
}

function assertStagePrerequisites(state: PlanningState, stage: Exclude<PlanningStage, "foundation">): void {
  const required: Record<Exclude<PlanningStage, "foundation">, PlanningStage[]> = {
    architecture: ["foundation"],
    roadmap: ["foundation", "architecture"],
    epics: ["foundation", "architecture", "roadmap"],
  }
  if (required[stage].some((requiredStage) => !state.completedStages.includes(requiredStage))) {
    throw new PlanningError("Planning stage " + stage + " requires earlier planning artifacts.")
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

function validatePlanningState(state: PlanningState): void {
  parsePlanningValue(planningStateSchema.safeParse(state), "Invalid planning state")
}

function stateNodes(state: PlanningState): Array<Vision | Constitution | Architecture | Roadmap | Epic | Story | Task> {
  return [
    ...(state.vision ? [state.vision] : []),
    ...(state.constitution ? [state.constitution] : []),
    ...(state.architecture ? [state.architecture] : []),
    ...(state.roadmap ? [state.roadmap] : []),
    ...(state.epics ?? []),
    ...(state.epics ?? []).flatMap((epic) => epic.stories),
    ...(state.epics ?? []).flatMap((epic) => epic.stories.flatMap((story) => story.tasks)),
  ]
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

function nodeType(node: Vision | Constitution | Architecture | Roadmap | Epic | Story | Task): string {
  if ("problem" in node) return "VISION"
  if ("principles" in node) return "CONSTITUTION"
  if ("components" in node) return "ARCHITECTURE"
  if ("milestones" in node) return "ROADMAP"
  if ("stories" in node) return "EPIC"
  if ("acceptanceCriteria" in node) return "STORY"
  return "TASK"
}

async function graphNodes(
  fileSystem: FileSystem,
  planPath: string,
  relationships: PlanningRelationship[],
): Promise<{ id: PlanningId, type: string }[]> {
  if (!(await fileSystem.exists(planPath))) {
    return [...new Set(relationships.flatMap((relationship) => [relationship.sourceId, relationship.targetId]))]
      .map((id) => ({ id, type: "UNKNOWN" }))
  }
  try {
    const plan = projectPlanSchema.parse(JSON.parse(await fileSystem.readText(planPath)))
    if (JSON.stringify(relationships) !== JSON.stringify(plan.relationships)) {
      throw new PlanningError("Planning graph relationships do not match the persisted plan.")
    }
    return [
      plan.vision,
      plan.constitution,
      plan.architecture,
      plan.roadmap,
      ...plan.epics,
      ...plan.epics.flatMap((epic) => epic.stories),
      ...plan.epics.flatMap((epic) => epic.stories.flatMap((story) => story.tasks)),
    ].map((node) => ({ id: node.id, type: nodeType(node) }))
  } catch (error) {
    throw new PlanningError("Unable to compile planning data into the Workspace Graph.", error)
  }
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
