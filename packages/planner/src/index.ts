import { createHash } from "node:crypto"
import { join } from "node:path"
import type {
  Architecture,
  Constitution,
  Epic,
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
import { SpectaError } from "@specta/core"
import type { FileSystem } from "@specta/filesystem"
import { nodeFileSystem } from "@specta/filesystem"
import {
  renderArchitecture,
  renderConstitution,
  renderEpic,
  renderRoadmap,
  renderVision,
} from "./templates.js"

export interface PlanningRequest {
  workspace: Workspace
  brief: string
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

export function createPlanningValidator(): PlanningValidator {
  return {
    validate(plan) {
      const entities = [
        plan.vision,
        plan.constitution,
        plan.architecture,
        plan.roadmap,
        ...plan.epics,
        ...plan.epics.flatMap((epic) => epic.stories),
        ...plan.epics.flatMap((epic) => epic.stories.flatMap((story) => story.tasks)),
      ]
      if (entities.some((entity) => !entity.id)) {
        throw new PlanningError("Every planning entity requires an ID.")
      }
      const textValues = [
        plan.vision.title,
        plan.vision.problem,
        plan.vision.audience,
        plan.vision.outcome,
        plan.architecture.overview,
        ...plan.constitution.principles,
        ...plan.architecture.components,
        ...plan.roadmap.milestones,
        ...plan.epics.flatMap((epic) => [epic.title, epic.goal]),
        ...plan.epics.flatMap((epic) => epic.stories.flatMap((story) => [
          story.title,
          story.description,
          ...story.acceptanceCriteria,
          ...story.tasks.flatMap((task) => [task.title, task.description]),
        ])),
      ]
      if (textValues.some((value) => value.trim().length === 0)) {
        throw new PlanningError("Planning content must not be empty.")
      }
      if (plan.epics.length === 0 || plan.epics.some((epic) => epic.stories.length === 0)) {
        throw new PlanningError("Every plan requires epics with stories.")
      }
      if (plan.epics.some((epic) => epic.stories.some((story) =>
        story.acceptanceCriteria.length === 0 || story.tasks.length === 0,
      ))) {
        throw new PlanningError("Every story requires acceptance criteria and tasks.")
      }
      const ids = new Set(entities.map((entity) => entity.id))
      if (ids.size !== entities.length) throw new PlanningError("Planning entity IDs must be unique.")
      if (plan.relationships.some((relationship) =>
        !ids.has(relationship.sourceId) || !ids.has(relationship.targetId) ||
        relationship.sourceId === relationship.targetId,
      )) {
        throw new PlanningError("Planning relationships must reference plan entities.")
      }
      const relationshipKeys = new Set(plan.relationships.map((relationship) =>
        relationship.type + ":" + relationship.sourceId + ":" + relationship.targetId,
      ))
      if (relationshipKeys.size !== plan.relationships.length) {
        throw new PlanningError("Planning relationships must be unique.")
      }
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
        const plan = JSON.parse(await fileSystem.readText(planPath)) as ProjectPlan
        createPlanningValidator().validate(plan)
        return plan
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
    const plan = JSON.parse(await fileSystem.readText(planPath)) as ProjectPlan
    createPlanningValidator().validate(plan)
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

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "epic"
}
