import { createHash } from "node:crypto"
import { z } from "zod"

export type WorkspaceId = string & { readonly __brand: "WorkspaceId" }
export type ProjectId = string & { readonly __brand: "ProjectId" }
export type PlanningId = string & { readonly __brand: "PlanningId" }

export const planningIdSchema = z.string().min(1).transform((value) => value as PlanningId)
export const workspaceIdSchema = z.string().min(1).transform((value) => value as WorkspaceId)
export const projectIdSchema = z.string().min(1).transform((value) => value as ProjectId)

/** Creates a stable planning-entity ID from its kind and canonical semantic input. */
export function createPlanningId(kind: string, value: string): PlanningId {
  return ("plan_" + createHash("sha256").update(kind + ":" + value).digest("hex").slice(0, 16)) as PlanningId
}
const nonEmptyTextSchema = z.string().trim().min(1)
export const planningBriefSchema = nonEmptyTextSchema

export const projectKindSchema = z.enum(["application", "library", "package", "service", "unknown"])
export type ProjectKind = z.infer<typeof projectKindSchema>
export const packageManagerSchema = z.enum(["npm", "pnpm", "yarn", "unknown"])
export type PackageManager = z.infer<typeof packageManagerSchema>
export const skillTargetSchema = z.string().regex(/^[a-z][a-z0-9-]*$/)
export type SkillTarget = z.infer<typeof skillTargetSchema>
export type WorkflowTemplateId = "plan" | "design" | "scaffold" | "implement" | "review" | "validate" | "context"

const identifierSchema = skillTargetSchema
export const workflowParameterSchema = z.object({
  name: identifierSchema,
  description: nonEmptyTextSchema,
  required: z.boolean(),
}).strict()
export type WorkflowParameter = z.infer<typeof workflowParameterSchema>

export const workflowDefinitionSchema = z.object({
  name: identifierSchema,
  description: nonEmptyTextSchema,
  parameters: z.array(workflowParameterSchema),
  requires: z.array(identifierSchema),
  produces: z.array(identifierSchema),
  executionSteps: z.array(identifierSchema).min(1),
  promptTemplate: nonEmptyTextSchema,
  artifactTemplates: z.array(nonEmptyTextSchema),
  completionCriteria: z.array(nonEmptyTextSchema),
  validationRequirements: z.array(identifierSchema),
}).strict().superRefine((definition, context) => {
  if (definition.promptTemplate !== ".specta/workflows/prompts/" + definition.name + ".md") {
    context.addIssue({ code: "custom", message: "Prompt template must match the workflow name.", path: ["promptTemplate"] })
  }
  if (definition.artifactTemplates.some((path) =>
    !/^\.specta\/workflows\/artifacts\/(vision|constitution|architecture|roadmap|epic)\.md$/.test(path),
  )) {
    context.addIssue({ code: "custom", message: "Artifact template path is not managed by Specta.", path: ["artifactTemplates"] })
  }
})
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>

export const workflowManifestSchema = z.object({
  version: z.literal(1),
  workflows: z.array(workflowDefinitionSchema).min(1),
}).strict().superRefine((manifest, context) => {
  const names = manifest.workflows.map((workflow) => workflow.name)
  if (new Set(names).size !== names.length) {
    context.addIssue({ code: "custom", message: "Workflow names must be unique.", path: ["workflows"] })
  }
})
export type WorkflowManifest = z.infer<typeof workflowManifestSchema>

export const workflowConfigurationSchema = z.object({
  skillTargets: z.array(skillTargetSchema).refine((targets) => new Set(targets).size === targets.length, "Skill targets must be unique."),
  manifestPath: z.literal(".specta/workflows/manifest.json"),
}).strict()
export type WorkflowConfiguration = z.infer<typeof workflowConfigurationSchema>

export const workflowTemplateIds: readonly WorkflowTemplateId[] = [
  "plan",
  "design",
  "scaffold",
  "implement",
  "review",
  "validate",
  "context",
]

export const projectSchema = z.object({
  id: projectIdSchema,
  name: nonEmptyTextSchema,
  rootPath: nonEmptyTextSchema,
  kind: projectKindSchema,
  manifestPath: nonEmptyTextSchema,
}).strict()
export type Project = z.infer<typeof projectSchema>

export const workspaceArtifactsSchema = z.object({
  visionPath: nonEmptyTextSchema.optional(),
  constitutionPath: nonEmptyTextSchema.optional(),
  architecturePath: nonEmptyTextSchema.optional(),
  roadmapPath: nonEmptyTextSchema.optional(),
  planningPath: nonEmptyTextSchema.optional(),
  globalRulesPath: nonEmptyTextSchema.optional(),
}).strict()
export type WorkspaceArtifacts = z.infer<typeof workspaceArtifactsSchema>

export const visionSchema = z.object({
  id: planningIdSchema,
  title: nonEmptyTextSchema,
  problem: nonEmptyTextSchema,
  audience: nonEmptyTextSchema,
  outcome: nonEmptyTextSchema,
}).strict()
export type Vision = z.infer<typeof visionSchema>

export const constitutionSchema = z.object({
  id: planningIdSchema,
  principles: z.array(nonEmptyTextSchema).min(1).superRefine(uniqueStrings("Constitution principles")),
}).strict()
export type Constitution = z.infer<typeof constitutionSchema>

/** Agent-authored Foundation content before Specta assigns deterministic IDs. */
export const foundationDraftSchema = z.object({
  vision: visionSchema.omit({ id: true }),
  constitution: constitutionSchema.omit({ id: true }),
}).strict()
export type FoundationDraft = z.infer<typeof foundationDraftSchema>

export const architectureSchema = z.object({
  id: planningIdSchema,
  overview: nonEmptyTextSchema,
  components: z.array(nonEmptyTextSchema).min(1).superRefine(uniqueStrings("Architecture components")),
  guidance: nonEmptyTextSchema.optional(),
}).strict()
export type Architecture = z.infer<typeof architectureSchema>

/** Agent-authored Architecture content before Specta assigns its graph ID. */
export const architectureDraftSchema = z.object({
  overview: architectureSchema.shape.overview,
  components: architectureSchema.shape.components,
}).strict()
export type ArchitectureDraft = z.infer<typeof architectureDraftSchema>

/** Validated semantic content for one ordered Roadmap delivery milestone. */
export const roadmapMilestoneSchema = z.object({
  title: nonEmptyTextSchema,
  objective: nonEmptyTextSchema,
  outcomes: z.array(nonEmptyTextSchema).min(1).superRefine(uniqueStrings("Roadmap milestone outcomes")),
}).strict()
/** Agent-authored Roadmap content before Specta assigns graph metadata. */
export const roadmapDraftSchema = z.object({
  milestones: z.array(roadmapMilestoneSchema).min(1)
    .superRefine(uniqueNamedItems("Roadmap milestone titles", (milestone) => milestone.title)),
}).strict()
export type RoadmapDraft = z.infer<typeof roadmapDraftSchema>

export const roadmapSchema = roadmapDraftSchema.extend({
  id: planningIdSchema,
}).strict()
export type Roadmap = z.infer<typeof roadmapSchema>

/** Agent-authored Task content before Specta assigns graph metadata. */
export const taskDraftSchema = z.object({
  title: nonEmptyTextSchema,
  description: nonEmptyTextSchema,
}).strict()
export type TaskDraft = z.infer<typeof taskDraftSchema>

export const taskSchema = taskDraftSchema.extend({ id: planningIdSchema }).strict()
export type Task = z.infer<typeof taskSchema>

/** Agent-authored Story content with nested criteria and Tasks. */
export const storyDraftSchema = z.object({
  title: nonEmptyTextSchema,
  description: nonEmptyTextSchema,
  acceptanceCriteria: z.array(nonEmptyTextSchema).min(1)
    .superRefine(uniqueStrings("Story acceptance criteria")),
  tasks: z.array(taskDraftSchema).min(1)
    .superRefine(uniqueNamedItems("Story task titles", (task) => task.title)),
}).strict()
export type StoryDraft = z.infer<typeof storyDraftSchema>

/** Canonical graph-backed acceptance criterion assigned to a Story. */
export const acceptanceCriterionSchema = z.object({
  id: planningIdSchema,
  description: nonEmptyTextSchema,
}).strict()
export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>

export const storySchema = storyDraftSchema.omit({ acceptanceCriteria: true, tasks: true }).extend({
  id: planningIdSchema,
  acceptanceCriteria: z.array(acceptanceCriterionSchema).min(1),
  tasks: z.array(taskSchema).min(1),
}).strict()
export type Story = z.infer<typeof storySchema>

/** Agent-authored Epic content associated with an approved Roadmap milestone. */
export const epicDraftSchema = z.object({
  title: nonEmptyTextSchema,
  goal: nonEmptyTextSchema,
  roadmapMilestone: nonEmptyTextSchema,
  stories: z.array(storyDraftSchema).min(1)
    .superRefine(uniqueNamedItems("Epic story titles", (story) => story.title)),
}).strict()
export type EpicDraft = z.infer<typeof epicDraftSchema>

/** Content-only Epics stage submission validated before deterministic materialization. */
export const epicsDraftSchema = z.object({
  epics: z.array(epicDraftSchema).min(1)
    .superRefine(uniqueNamedItems("Epic titles", (epic) => epic.title)),
}).strict()
export type EpicsDraft = z.infer<typeof epicsDraftSchema>

export const epicSchema = epicDraftSchema.omit({ stories: true }).extend({
  id: planningIdSchema,
  stories: z.array(storySchema).min(1),
}).strict()
export type Epic = z.infer<typeof epicSchema>

export const planningRelationshipTypeSchema = z.enum(["CONTAINS", "DEPENDS_ON", "IMPLEMENTS"])
export type PlanningRelationshipType = z.infer<typeof planningRelationshipTypeSchema>

export const planningRelationshipSchema = z.object({
  type: planningRelationshipTypeSchema,
  sourceId: planningIdSchema,
  targetId: planningIdSchema,
}).strict().refine((relationship) => relationship.sourceId !== relationship.targetId, {
  message: "Planning relationships cannot reference the same source and target.",
})
export type PlanningRelationship = z.infer<typeof planningRelationshipSchema>

export const projectPlanSchema = z.object({
  vision: visionSchema,
  constitution: constitutionSchema,
  architecture: architectureSchema,
  roadmap: roadmapSchema,
  epics: z.array(epicSchema).min(1),
  relationships: z.array(planningRelationshipSchema),
}).strict().superRefine((plan, context) => {
  validatePlanningGraphReferences(planningNodeIds(plan), plan.relationships, context)
  validatePlanningGraphSemantics(plan, context)
})
export type ProjectPlan = z.infer<typeof projectPlanSchema>

export const planningStageSchema = z.enum(["foundation", "architecture", "roadmap", "epics"])
export type PlanningStage = z.infer<typeof planningStageSchema>

/** Structural planning-state schema reused by persistence migrations before canonical refinement. */
export const planningStateDataSchema = z.object({
  brief: nonEmptyTextSchema,
  completedStages: z.array(planningStageSchema),
  vision: visionSchema.optional(),
  constitution: constitutionSchema.optional(),
  architecture: architectureSchema.optional(),
  roadmap: roadmapSchema.optional(),
  epics: z.array(epicSchema).min(1).optional(),
  relationships: z.array(planningRelationshipSchema),
}).strict()

export const planningStateSchema = planningStateDataSchema.superRefine((state, context) => {
  const expectedOrder: PlanningStage[] = ["foundation", "architecture", "roadmap", "epics"]
  if (state.completedStages.some((stage, index) => stage !== expectedOrder[index])) {
    context.addIssue({ code: "custom", message: "Planning stages must be completed in order.", path: ["completedStages"] })
  }
  const hasFoundation = state.vision !== undefined && state.constitution !== undefined
  if (state.completedStages.includes("foundation") !== hasFoundation) {
    context.addIssue({ code: "custom", message: "Vision and Constitution must exist exactly when Foundation is complete." })
  }
  if (state.completedStages.includes("architecture") !== (state.architecture !== undefined)) {
    context.addIssue({ code: "custom", message: "Architecture must exist exactly when its stage is complete.", path: ["architecture"] })
  }
  if (state.completedStages.includes("roadmap") !== (state.roadmap !== undefined)) {
    context.addIssue({ code: "custom", message: "Roadmap must exist exactly when its stage is complete.", path: ["roadmap"] })
  }
  if (state.completedStages.includes("epics") !== (state.epics !== undefined)) {
    context.addIssue({ code: "custom", message: "Epics must exist exactly when their stage is complete.", path: ["epics"] })
  }
  validatePlanningGraphReferences(planningNodeIds(state), state.relationships, context)
  validatePlanningGraphSemantics(state, context)
})
export type PlanningState = z.infer<typeof planningStateSchema>

export interface PlanningArtifact {
  kind: "vision" | "constitution" | "architecture" | "roadmap" | "epic"
  path: string
}

export interface PlanningArtifactSet {
  rootPath: string
  documents: PlanningArtifact[]
}

export const technicalDesignStatusSchema = z.enum(["draft", "needs-changes", "approved"])
export type TechnicalDesignStatus = z.infer<typeof technicalDesignStatusSchema>
export const technicalFileKindSchema = z.enum(["source", "test", "configuration"])
export type TechnicalFileKind = z.infer<typeof technicalFileKindSchema>
export const technicalSymbolKindSchema = z.enum(["class", "interface", "function", "type", "constant"])
export type TechnicalSymbolKind = z.infer<typeof technicalSymbolKindSchema>
export const technicalDependencyStatusSchema = z.enum(["available", "planned", "blocked"])
export type TechnicalDependencyStatus = z.infer<typeof technicalDependencyStatusSchema>

export const technicalSymbolSchema = z.object({
  name: nonEmptyTextSchema,
  kind: technicalSymbolKindSchema,
  signature: nonEmptyTextSchema.optional(),
  purpose: nonEmptyTextSchema,
}).strict()
export type TechnicalSymbol = z.infer<typeof technicalSymbolSchema>

const technicalFilePathSchema = z.string().refine((path) =>
  /^src\/[a-z0-9-]+\/[a-z0-9-]+(?:\.(?:types|service))?\.ts$/.test(path) ||
  /^src\/[a-z0-9-]+\/index\.ts$/.test(path),
"Technical file path must be a managed TypeScript source path.")

export const technicalFileSchema = z.object({
  path: technicalFilePathSchema,
  kind: technicalFileKindSchema,
  exports: z.array(technicalSymbolSchema),
}).strict()
export type TechnicalFile = z.infer<typeof technicalFileSchema>

export const technicalModuleSchema = z.object({
  name: nonEmptyTextSchema,
  path: nonEmptyTextSchema,
  purpose: nonEmptyTextSchema,
  files: z.array(technicalFileSchema).min(1),
  dependencies: z.array(planningIdSchema),
}).strict()
export type TechnicalModule = z.infer<typeof technicalModuleSchema>

export const technicalDependencySchema = z.object({
  targetId: planningIdSchema,
  kind: z.enum(["file", "symbol", "technical-design"]),
  status: technicalDependencyStatusSchema,
}).strict()
export type TechnicalDependency = z.infer<typeof technicalDependencySchema>

export const impactRequestSchema = z.object({
  targetId: planningIdSchema,
  description: nonEmptyTextSchema,
}).strict()
export type ImpactRequest = z.infer<typeof impactRequestSchema>

export const technicalDesignSchema = z.object({
  id: planningIdSchema,
  targetId: planningIdSchema,
  status: technicalDesignStatusSchema,
  revision: z.number().int().positive(),
  summary: nonEmptyTextSchema,
  modules: z.array(technicalModuleSchema).min(1),
  dependencies: z.array(technicalDependencySchema),
  impactRequests: z.array(impactRequestSchema),
  feedback: nonEmptyTextSchema.optional(),
  scaffoldedPaths: z.array(technicalFilePathSchema).optional(),
}).strict().superRefine((design, context) => {
  const paths = design.modules.flatMap((module) => module.files.map((file) => file.path))
  if (new Set(paths).size !== paths.length) {
    context.addIssue({ code: "custom", message: "Technical Design file paths must be unique.", path: ["modules"] })
  }
})
export type TechnicalDesign = z.infer<typeof technicalDesignSchema>

export const technicalDesignCollectionSchema = z.object({
  designs: z.array(technicalDesignSchema),
}).strict()

export interface ScaffoldResult {
  designId: PlanningId
  createdPaths: string[]
  preservedPaths: string[]
  workspace: Workspace
}

export const workspaceSchema = z.object({
  schemaVersion: z.literal(1),
  id: workspaceIdSchema,
  rootPath: nonEmptyTextSchema,
  createdAt: z.iso.datetime(),
  packageManager: packageManagerSchema,
  projects: z.array(projectSchema),
  artifacts: workspaceArtifactsSchema,
  workflow: workflowConfigurationSchema,
}).strict()
export type Workspace = z.infer<typeof workspaceSchema>

export class SpectaError extends Error {
  public readonly code: string
  public override readonly cause?: unknown

  public constructor(message: string, code: string, cause?: unknown) {
    super(message)
    this.name = "SpectaError"
    this.code = code
    this.cause = cause
  }
}

export class ConfigurationError extends SpectaError {
  public constructor(message: string, cause?: unknown) {
    super(message, "CONFIGURATION_ERROR", cause)
    this.name = "ConfigurationError"
  }
}

export class DiscoveryError extends SpectaError {
  public constructor(message: string, cause?: unknown) {
    super(message, "DISCOVERY_ERROR", cause)
    this.name = "DiscoveryError"
  }
}

function uniqueStrings(label: string) {
  return (values: string[], context: z.RefinementCtx): void => {
    const normalized = values.map((value) => value.toLowerCase())
    if (new Set(normalized).size !== normalized.length) {
      context.addIssue({ code: "custom", message: label + " must be unique." })
    }
  }
}

function uniqueNamedItems<T>(label: string, name: (value: T) => string) {
  return (values: T[], context: z.RefinementCtx): void => {
    const seen = new Set<string>()
    for (const [index, value] of values.entries()) {
      const key = name(value).toLowerCase()
      if (seen.has(key)) {
        context.addIssue({ code: "custom", message: label + " must be unique.", path: [index, "title"] })
      }
      seen.add(key)
    }
  }
}

function planningNodeIds(value: {
  vision?: Vision | undefined
  constitution?: Constitution | undefined
  architecture?: Architecture | undefined
  roadmap?: Roadmap | undefined
  epics?: Epic[] | undefined
}): PlanningId[] {
  return [
    ...(value.vision ? [value.vision.id] : []),
    ...(value.constitution ? [value.constitution.id] : []),
    ...(value.architecture ? [value.architecture.id] : []),
    ...(value.roadmap ? [value.roadmap.id] : []),
    ...(value.epics ?? []).flatMap((epic) => [
      epic.id,
      ...epic.stories.flatMap((story) => [
        story.id,
        ...story.acceptanceCriteria.map((criterion) => criterion.id),
        ...story.tasks.map((task) => task.id),
      ]),
    ]),
  ]
}

function validatePlanningGraphReferences(
  nodeIds: PlanningId[],
  relationships: PlanningRelationship[],
  context: z.RefinementCtx,
): void {
  const ids = new Set(nodeIds)
  if (ids.size !== nodeIds.length) {
    context.addIssue({ code: "custom", message: "Planning entity IDs must be unique." })
  }
  if (relationships.some((relationship) => !ids.has(relationship.sourceId) || !ids.has(relationship.targetId))) {
    context.addIssue({ code: "custom", message: "Planning relationships must reference available planning artifacts.", path: ["relationships"] })
  }
  const keys = relationships.map((relationship) =>
    relationship.type + ":" + relationship.sourceId + ":" + relationship.targetId,
  )
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: "custom", message: "Planning relationships must be unique.", path: ["relationships"] })
  }
}

function validatePlanningGraphSemantics(
  value: {
    architecture?: Architecture | undefined
    roadmap?: Roadmap | undefined
    epics?: Epic[] | undefined
    relationships: PlanningRelationship[]
  },
  context: z.RefinementCtx,
): void {
  if (!value.architecture || !value.roadmap || !value.epics) return
  const keys = new Set(value.relationships.map((relationship) =>
    relationship.type + ":" + relationship.sourceId + ":" + relationship.targetId,
  ))
  const required = value.epics.flatMap((epic): PlanningRelationship[] => [
    { type: "DEPENDS_ON", sourceId: epic.id, targetId: value.roadmap!.id },
    { type: "IMPLEMENTS", sourceId: epic.id, targetId: value.architecture!.id },
    ...epic.stories.flatMap((story): PlanningRelationship[] => [
      { type: "CONTAINS", sourceId: epic.id, targetId: story.id },
      ...story.acceptanceCriteria.map((criterion): PlanningRelationship => ({
        type: "CONTAINS",
        sourceId: story.id,
        targetId: criterion.id,
      })),
      ...story.tasks.map((task): PlanningRelationship => ({
        type: "CONTAINS",
        sourceId: story.id,
        targetId: task.id,
      })),
    ]),
  ])
  if (required.some((relationship) => !keys.has(
    relationship.type + ":" + relationship.sourceId + ":" + relationship.targetId,
  ))) {
    context.addIssue({ code: "custom", message: "Planning graph is missing required Epic relationships.", path: ["relationships"] })
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
