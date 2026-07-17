import { createWorkspaceRepository, type WorkspaceRepository } from "@specta/config"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  type PlanningArtifactSet,
  type FoundationDraft,
  type PlanningStage,
  type PlanningState,
  type ProjectPlan,
  type WorkflowDefinition,
  type WorkflowManifest,
  type Workspace,
  workflowManifestSchema,
} from "@specta/core"
import type { FileSystem } from "@specta/filesystem"
import { nodeFileSystem } from "@specta/filesystem"
import type {
  Planner,
  ProgressivePlanner,
  PlanningStateRepository,
  PlanningStateGraphUpdater,
} from "@specta/planner"

export {
  createScaffoldWorkflow,
  createTechnicalDesignApprovalWorkflow,
  createTechnicalDesignRepository,
  createTechnicalDesignWorkflow,
  type ScaffoldWorkflow,
  type ScaffoldWorkflowRequest,
  type TechnicalDesignApprovalWorkflow,
  type TechnicalDesignRepository,
  type TechnicalDesignRequest,
  type TechnicalDesignWorkflow,
} from "./technical-design.ts"
import {
  createFoundationPlanningState,
  createPlanner,
  createProgressivePlanner,
  createPlanningStateRepository,
  createPlanningStateGraphUpdater,
} from "@specta/planner"

export interface PlanWorkflowRequest {
  workspace: Workspace
  brief?: string
  stage?: PlanningStage | "next"
  draft?: PlanningState | FoundationDraft
}

export interface PlanWorkflowResult {
  /** Present after the final epics stage; earlier stages intentionally produce partial planning state. */
  plan: ProjectPlan | undefined
  state: PlanningState
  stage: PlanningStage
  artifacts: PlanningArtifactSet
  workspace: Workspace
}

export interface PlanWorkflow {
  execute(request: PlanWorkflowRequest): Promise<PlanWorkflowResult>
}

export interface WorkflowManifestRepository {
  load(workspace: Workspace): Promise<WorkflowManifest>
  ensure(workspace: Workspace): Promise<void>
  loadPrompt(workspace: Workspace, definition: WorkflowDefinition): Promise<string>
  loadArtifactTemplates(workspace: Workspace, definition: WorkflowDefinition): Promise<Partial<Record<PlanningArtifactSet["documents"][number]["kind"], string>>>
}

export function createWorkflowManifestRepository(
  fileSystem = nodeFileSystem,
): WorkflowManifestRepository {
  return {
    async load(workspace) {
      const manifestPath = join(workspace.rootPath, workspace.workflow.manifestPath)
      if (!(await fileSystem.exists(manifestPath))) {
        throw new Error("Workflow Manifest is missing. Run specta init to restore workspace workflows.")
      }
      try {
        return workflowManifestSchema.parse(JSON.parse(await fileSystem.readText(manifestPath)))
      } catch (error) {
        throw new Error("Workflow Manifest is invalid.", { cause: error })
      }
    },
    async ensure(workspace) {
      const manifestPath = join(workspace.rootPath, workspace.workflow.manifestPath)
      const exists = await fileSystem.exists(manifestPath)
      const existing = exists ? await this.load(workspace) : undefined
      const manifest = existing === undefined ? defaultWorkflowManifest() : mergeDefaultWorkflows(existing)
      if (!exists || existing?.workflows.length !== manifest.workflows.length) {
        await fileSystem.writeText(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
      }
      await Promise.all(manifest.workflows.map(async (definition) => {
        const promptPath = join(workspace.rootPath, definition.promptTemplate)
        const bundledPrompt = await bundledPromptTemplate(definition, fileSystem)
        if (!(await fileSystem.exists(promptPath))) {
          await fileSystem.writeText(promptPath, bundledPrompt)
        } else {
          const existingPrompt = await fileSystem.readText(promptPath)
          if (existingPrompt === defaultPromptTemplate(definition) && existingPrompt !== bundledPrompt) {
            await fileSystem.writeText(promptPath, bundledPrompt)
          }
        }
        await Promise.all(definition.artifactTemplates.map(async (templatePath) => {
          const absolutePath = join(workspace.rootPath, templatePath)
          if (!(await fileSystem.exists(absolutePath))) {
            await fileSystem.writeText(absolutePath, defaultArtifactTemplate(templatePath))
          }
        }))
      }))
    },
    async loadPrompt(workspace, definition) {
      const promptPath = join(workspace.rootPath, definition.promptTemplate)
      if (!(await fileSystem.exists(promptPath))) {
        throw new Error("Prompt Template is missing for workflow " + definition.name + ".")
      }
      return fileSystem.readText(promptPath)
    },
    async loadArtifactTemplates(workspace, definition) {
      const entries = await Promise.all(definition.artifactTemplates.map(async (path) => {
        const kind = artifactKindForTemplate(path)
        if (kind === undefined) throw new Error("Unsupported planning artifact template: " + path + ".")
        return [kind, await fileSystem.readText(join(workspace.rootPath, path))] as const
      }))
      return Object.fromEntries(entries)
    },
  }
}

function mergeDefaultWorkflows(manifest: WorkflowManifest): WorkflowManifest {
  const existing = new Set(manifest.workflows.map((workflow) => workflow.name))
  const additions = defaultWorkflowManifest().workflows.filter((workflow) => !existing.has(workflow.name))
  return additions.length === 0 ? manifest : { ...manifest, workflows: [...manifest.workflows, ...additions] }
}

export function createPlanWorkflow(
  planner: Planner = createPlanner(),
  workspaceRepository: WorkspaceRepository = createWorkspaceRepository(nodeFileSystem),
  definitions: WorkflowManifestRepository = createWorkflowManifestRepository(),
  progressivePlanner: ProgressivePlanner = createProgressivePlanner(),
  stateRepository: PlanningStateRepository = createPlanningStateRepository(),
  stateGraphUpdater: PlanningStateGraphUpdater = createPlanningStateGraphUpdater(),
): PlanWorkflow {
  return {
    async execute(request) {
      const manifest = await definitions.load(request.workspace)
      const currentState = await stateRepository.load(request.workspace)
      const stage = resolvePlanningStage(request.stage, currentState)
      const definition = manifest.workflows.find((workflow) => workflow.name === workflowForStage(stage))
      if (definition === undefined) throw new Error("Workflow Manifest does not define " + workflowForStage(stage) + ".")
      enforceRequirements(definition, currentState)
      if (stage === "foundation" && (request.brief?.trim().length ?? 0) === 0) throw new Error("The foundation planning workflow requires a brief.")
      if (stage !== "foundation" && request.brief !== undefined) throw new Error("Only the foundation planning stage accepts a brief.")
      const prompt = await definitions.loadPrompt(request.workspace, definition)
      const templates = await definitions.loadArtifactTemplates(request.workspace, definition)
      let state: PlanningState | undefined
      let artifactSet: PlanningArtifactSet | undefined
      let workspace = request.workspace
      for (const step of definition.executionSteps) {
        if (step === "compile-workspace") continue
        if (step === "generate-foundation" || step === "generate-architecture" || step === "generate-roadmap" || step === "generate-epics") {
          if (request.draft === undefined) throw new Error("The " + definition.name + " workflow requires an agent-authored draft.")
          if (stage === "foundation") {
            state = createFoundationPlanningState(request.brief ?? "", request.draft)
          } else {
            state = request.draft as PlanningState
            progressivePlanner.validate(state)
          }
          ensureUpstreamArtifactsPreserved(currentState, state, stage)
          ensureStageOwnsOnlyItsArtifact(currentState, state, stage)
          if (state.completedStages.at(-1) !== stage) throw new Error("The submitted draft does not complete the requested planning stage.")
          continue
        }
        if (step === "persist-planning-stage" && state !== undefined) {
          artifactSet = await stateRepository.save(request.workspace, state, stage, templates)
          continue
        }
        if (step === "update-workspace-graph" && state !== undefined) {
          await stateGraphUpdater.apply(request.workspace, state)
          continue
        }
        if (step === "persist-workspace" && artifactSet !== undefined) {
          workspace = workspaceWithPlanningArtifacts(request.workspace, artifactSet)
          await workspaceRepository.save(workspace)
          continue
        }
        throw new Error("Unsupported planning workflow step: " + step + ".")
      }
      if (state === undefined || artifactSet === undefined) {
        throw new Error("The plan workflow definition is incomplete.")
      }
      if (definition.validationRequirements.includes("planning-stage")) progressivePlanner.validate(state)
      if (definition.validationRequirements.includes("planning-artifacts")) {
        const completePlan = projectPlanFromState(state)
        if (completePlan) planner.validate(completePlan)
      }
      ensureProduced(definition, state)
      return { plan: projectPlanFromState(state), state, stage, artifacts: artifactSet, workspace }
    },
  }
}

export function defaultWorkflowManifest(): WorkflowManifest {
  return {
    version: 1,
    workflows: [
      planningWorkflow("plan", "Execute the next eligible planning stage.", [], [], ["select-next-planning-stage"], [], []),
      planningWorkflow("plan-foundation", "Generate Vision and Constitution from a planning brief.", [], ["vision", "constitution"], ["compile-workspace", "generate-foundation", "persist-planning-stage", "update-workspace-graph", "persist-workspace"], ["vision", "constitution"], ["planning-stage"]),
      planningWorkflow("plan-architecture", "Generate Architecture from Vision and Constitution.", ["vision", "constitution"], ["architecture"], ["compile-workspace", "generate-architecture", "persist-planning-stage", "update-workspace-graph", "persist-workspace"], ["architecture"], ["planning-stage"]),
      planningWorkflow("plan-roadmap", "Generate Roadmap from approved planning artifacts.", ["vision", "constitution", "architecture"], ["roadmap"], ["compile-workspace", "generate-roadmap", "persist-planning-stage", "update-workspace-graph", "persist-workspace"], ["roadmap"], ["planning-stage"]),
      planningWorkflow("plan-epics", "Generate Epics with nested Stories, acceptance criteria and Tasks.", ["vision", "constitution", "architecture", "roadmap"], ["epics"], ["compile-workspace", "generate-epics", "persist-planning-stage", "update-workspace-graph", "persist-workspace"], ["epic"], ["planning-stage"]),
      workflow("design", "Create a reviewable technical design for one Epic.", ["architecture", "epics"], ["technical-design"], ["resolve-epic", "generate-technical-design", "persist-technical-design"], [{ name: "target-id", description: "The Epic to design.", required: true }]),
      workflow("approve-design", "Approve a reviewed technical design.", ["technical-design"], ["approved-technical-design"], ["resolve-technical-design", "validate-dependencies", "approve-technical-design"], [{ name: "design-id", description: "The Technical Design to approve.", required: true }]),
      workflow("scaffold", "Create folders and declaration-only code skeletons from an approved technical design.", ["approved-technical-design"], ["scaffolded-structure"], ["resolve-technical-design", "validate-dependencies", "apply-scaffold", "update-workspace-graph"], [{ name: "design-id", description: "The approved Technical Design to scaffold.", required: true }]),
    ],
  }
}

function planningWorkflow(
  name: string,
  description: string,
  requires: string[],
  produces: string[],
  executionSteps: string[],
  artifactTemplates: string[],
  validationRequirements: string[],
): WorkflowDefinition {
  return {
    name,
    description,
    parameters: name === "plan-foundation" ? [{ name: "brief", description: "The planning brief.", required: true }] : [],
    requires,
    produces,
    executionSteps,
    promptTemplate: ".specta/workflows/prompts/" + name + ".md",
    artifactTemplates: artifactTemplates.map((name) => ".specta/workflows/artifacts/" + name + ".md"),
    completionCriteria: produces.map((artifact) => artifact + " is generated and linked to the Workspace Graph."),
    validationRequirements,
  }
}

function workflow(
  name: string,
  description: string,
  requires: string[],
  produces: string[],
  executionSteps: string[],
  parameters: WorkflowDefinition["parameters"],
): WorkflowDefinition {
  return {
    name,
    description,
    parameters,
    requires,
    produces,
    executionSteps,
    promptTemplate: ".specta/workflows/prompts/" + name + ".md",
    artifactTemplates: [],
    completionCriteria: produces.map((artifact) => artifact + " is generated and linked to the Workspace Graph."),
    validationRequirements: ["workflow-state"],
  }
}

function workspaceWithPlanningArtifacts(workspace: Workspace, artifactSet: PlanningArtifactSet): Workspace {
  const artifactPath = (kind: PlanningArtifactSet["documents"][number]["kind"]): string | undefined =>
    artifactSet.documents.find((document) => document.kind === kind)?.path
  const visionPath = artifactPath("vision")
  const constitutionPath = artifactPath("constitution")
  const architecturePath = artifactPath("architecture")
  const roadmapPath = artifactPath("roadmap")
  const updates = {
    ...(visionPath === undefined ? {} : { visionPath }),
    ...(constitutionPath === undefined ? {} : { constitutionPath }),
    ...(architecturePath === undefined ? {} : { architecturePath }),
    ...(roadmapPath === undefined ? {} : { roadmapPath }),
  }
  return {
    ...workspace,
    artifacts: {
      ...workspace.artifacts,
      ...updates,
      planningPath: artifactSet.rootPath,
    },
  }
}

function defaultPromptTemplate(definition: WorkflowDefinition): string {
  return [
    "# Specta " + definition.name + " workflow",
    "",
    definition.description,
    "",
    "Follow the Workspace Graph as the source of truth.",
    "Use only the context supplied for this workflow.",
    "Report the workflow outcome and validation results.",
    "",
  ].join("\n")
}

async function bundledPromptTemplate(
  definition: WorkflowDefinition,
  fileSystem: FileSystem,
): Promise<string> {
  const path = join(fileURLToPath(new URL("../templates/prompts", import.meta.url)), definition.name + ".md")
  return await fileSystem.exists(path) ? fileSystem.readText(path) : defaultPromptTemplate(definition)
}

function defaultArtifactTemplate(path: string): string {
  return "{{content}}\n"
}

function resolvePlanningStage(requested: PlanningStage | "next" | undefined, state: PlanningState | null): PlanningStage {
  if (requested && requested !== "next") {
    if (state?.completedStages.includes(requested)) {
      throw new Error("Planning stage " + requested + " is already complete; regeneration is not supported by this workflow.")
    }
    return requested
  }
  const stages: PlanningStage[] = ["foundation", "architecture", "roadmap", "epics"]
  const next = stages.find((stage) => !state?.completedStages.includes(stage))
  if (!next) throw new Error("All planning stages are complete. Explicitly regenerate a stage to replace it.")
  return next
}

function workflowForStage(stage: PlanningStage): string {
  return "plan-" + stage
}

function enforceRequirements(definition: WorkflowDefinition, state: PlanningState | null): void {
  const available = new Set<string>()
  if (state?.vision) available.add("vision")
  if (state?.constitution) available.add("constitution")
  if (state?.architecture) available.add("architecture")
  if (state?.roadmap) available.add("roadmap")
  if (state?.epics) available.add("epics")
  const missing = definition.requires.filter((artifact) => !available.has(artifact))
  if (missing.length > 0) throw new Error(definition.name + " requires: " + missing.join(", ") + ".")
}

function artifactKindForTemplate(path: string): PlanningArtifactSet["documents"][number]["kind"] | undefined {
  const match = /^\.specta\/workflows\/artifacts\/(vision|constitution|architecture|roadmap|epic)\.md$/.exec(path)
  return match?.[1] as PlanningArtifactSet["documents"][number]["kind"] | undefined
}

function ensureProduced(definition: WorkflowDefinition, state: PlanningState): void {
  const available = new Set<string>()
  if (state.vision) available.add("vision")
  if (state.constitution) available.add("constitution")
  if (state.architecture) available.add("architecture")
  if (state.roadmap) available.add("roadmap")
  if (state.epics) available.add("epics")
  const missing = definition.produces.filter((artifact) => !available.has(artifact))
  if (missing.length > 0) throw new Error(definition.name + " did not produce: " + missing.join(", ") + ".")
}

function ensureUpstreamArtifactsPreserved(
  current: PlanningState | null,
  submitted: PlanningState,
  stage: PlanningStage,
): void {
  if (current === null || stage === "foundation") return
  const fields: Array<keyof PlanningState> = stage === "architecture"
    ? ["vision", "constitution"]
    : stage === "roadmap"
      ? ["vision", "constitution", "architecture"]
      : ["vision", "constitution", "architecture", "roadmap"]
  if (fields.some((field) => JSON.stringify(current[field]) !== JSON.stringify(submitted[field]))) {
    throw new Error("A planning draft cannot replace approved upstream artifacts.")
  }
}

function ensureStageOwnsOnlyItsArtifact(
  current: PlanningState | null,
  submitted: PlanningState,
  stage: PlanningStage,
): void {
  const expected = stage === "foundation" ? ["foundation"] : [...(current?.completedStages ?? []), stage]
  if (JSON.stringify(submitted.completedStages) !== JSON.stringify(expected)) {
    throw new Error("A planning draft may submit only the requested stage.")
  }
}

function projectPlanFromState(state: PlanningState): ProjectPlan | undefined {
  if (!state.vision || !state.constitution || !state.architecture || !state.roadmap || !state.epics) return undefined
  return {
    vision: state.vision,
    constitution: state.constitution,
    architecture: state.architecture,
    roadmap: state.roadmap,
    epics: state.epics,
    relationships: state.relationships,
  }
}
