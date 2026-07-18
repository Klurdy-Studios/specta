import { fileURLToPath } from "node:url"
import { createWorkspaceRepository, type WorkspaceRepository } from "@specta/core/config"
import type { FoundationDraft, PlanningArtifactSet, PlanningStage, PlanningState, ProjectPlan, WorkflowDefinition, Workspace } from "@specta/core"
import { nodeFileSystem } from "@specta/core/filesystem"
import { createWorkflowManifestRepository, type WorkflowManifestRepository, type WorkflowModule } from "@specta/core/workflow"
import {
  createFoundationPlanningState,
  createPlanner,
  createPlanningStateGraphUpdater,
  createPlanningStateRepository,
  createProgressivePlanner,
  type Planner,
  type PlanningStateGraphUpdater,
  type PlanningStateRepository,
  type ProgressivePlanner,
} from "./planning.ts"

export interface PlanWorkflowRequest {
  workspace: Workspace
  brief?: string
  stage?: PlanningStage | "next"
  draft?: PlanningState | FoundationDraft
}

export interface PlanWorkflowResult {
  plan: ProjectPlan | undefined
  state: PlanningState
  stage: PlanningStage
  artifacts: PlanningArtifactSet
  workspace: Workspace
}

export interface PlanWorkflow {
  execute(request: PlanWorkflowRequest): Promise<PlanWorkflowResult>
}

export const planningWorkflowModule: WorkflowModule = {
  definitions: planningWorkflowDefinitions(),
  promptDirectory: fileURLToPath(new URL("../templates/prompts", import.meta.url)),
  skillDirectory: fileURLToPath(new URL("../templates/skills", import.meta.url)),
}

export function createPlanWorkflow(
  planner: Planner = createPlanner(),
  workspaceRepository: WorkspaceRepository = createWorkspaceRepository(nodeFileSystem),
  definitions: WorkflowManifestRepository = createWorkflowManifestRepository([planningWorkflowModule]),
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
      const templates = await definitions.loadArtifactTemplates(request.workspace, definition)
      await definitions.loadPrompt(request.workspace, definition)
      let state: PlanningState | undefined
      let artifactSet: PlanningArtifactSet | undefined
      let workspace = request.workspace
      for (const step of definition.executionSteps) {
        if (step === "compile-workspace") continue
        if (["generate-foundation", "generate-architecture", "generate-roadmap", "generate-epics"].includes(step)) {
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
      if (state === undefined || artifactSet === undefined) throw new Error("The plan workflow definition is incomplete.")
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

function planningWorkflowDefinitions(): WorkflowDefinition[] {
  return [
    planningWorkflow("plan", "Execute the next eligible planning stage.", [], [], ["select-next-planning-stage"], [], []),
    planningWorkflow("plan-foundation", "Generate Vision and Constitution from a planning brief.", [], ["vision", "constitution"], ["compile-workspace", "generate-foundation", "persist-planning-stage", "update-workspace-graph", "persist-workspace"], ["vision", "constitution"], ["planning-stage"]),
    planningWorkflow("plan-architecture", "Generate Architecture from Vision and Constitution.", ["vision", "constitution"], ["architecture"], ["compile-workspace", "generate-architecture", "persist-planning-stage", "update-workspace-graph", "persist-workspace"], ["architecture"], ["planning-stage"]),
    planningWorkflow("plan-roadmap", "Generate Roadmap from approved planning artifacts.", ["vision", "constitution", "architecture"], ["roadmap"], ["compile-workspace", "generate-roadmap", "persist-planning-stage", "update-workspace-graph", "persist-workspace"], ["roadmap"], ["planning-stage"]),
    planningWorkflow("plan-epics", "Generate Epics with nested Stories, acceptance criteria and Tasks.", ["vision", "constitution", "architecture", "roadmap"], ["epics"], ["compile-workspace", "generate-epics", "persist-planning-stage", "update-workspace-graph", "persist-workspace"], ["epic"], ["planning-stage"]),
  ]
}

function planningWorkflow(name: string, description: string, requires: string[], produces: string[], executionSteps: string[], artifactTemplates: string[], validationRequirements: string[]): WorkflowDefinition {
  return {
    name,
    description,
    parameters: name === "plan-foundation" ? [{ name: "brief", description: "The planning brief.", required: true }] : [],
    requires,
    produces,
    executionSteps,
    promptTemplate: ".specta/workflows/prompts/" + name + ".md",
    artifactTemplates: artifactTemplates.map((artifact) => ".specta/workflows/artifacts/" + artifact + ".md"),
    completionCriteria: produces.map((artifact) => artifact + " is generated and linked to the Workspace Graph."),
    validationRequirements,
  }
}

function workspaceWithPlanningArtifacts(workspace: Workspace, artifactSet: PlanningArtifactSet): Workspace {
  const artifactPath = (kind: PlanningArtifactSet["documents"][number]["kind"]): string | undefined =>
    artifactSet.documents.find((document) => document.kind === kind)?.path
  const visionPath = artifactPath("vision")
  const constitutionPath = artifactPath("constitution")
  const architecturePath = artifactPath("architecture")
  const roadmapPath = artifactPath("roadmap")
  return {
    ...workspace,
    artifacts: {
      ...workspace.artifacts,
      ...(visionPath === undefined ? {} : { visionPath }),
      ...(constitutionPath === undefined ? {} : { constitutionPath }),
      ...(architecturePath === undefined ? {} : { architecturePath }),
      ...(roadmapPath === undefined ? {} : { roadmapPath }),
      planningPath: artifactSet.rootPath,
    },
  }
}

function resolvePlanningStage(requested: PlanningStage | "next" | undefined, state: PlanningState | null): PlanningStage {
  if (requested && requested !== "next") {
    if (state?.completedStages.includes(requested)) throw new Error("Planning stage " + requested + " is already complete; regeneration is not supported by this workflow.")
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
  const available = planningArtifacts(state)
  const missing = definition.requires.filter((artifact) => !available.has(artifact))
  if (missing.length > 0) throw new Error(definition.name + " requires: " + missing.join(", ") + ".")
}

function ensureProduced(definition: WorkflowDefinition, state: PlanningState): void {
  const available = planningArtifacts(state)
  const missing = definition.produces.filter((artifact) => !available.has(artifact))
  if (missing.length > 0) throw new Error(definition.name + " did not produce: " + missing.join(", ") + ".")
}

function planningArtifacts(state: PlanningState | null): Set<string> {
  const available = new Set<string>()
  if (state?.vision) available.add("vision")
  if (state?.constitution) available.add("constitution")
  if (state?.architecture) available.add("architecture")
  if (state?.roadmap) available.add("roadmap")
  if (state?.epics) available.add("epics")
  return available
}

function ensureUpstreamArtifactsPreserved(current: PlanningState | null, submitted: PlanningState, stage: PlanningStage): void {
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

function ensureStageOwnsOnlyItsArtifact(current: PlanningState | null, submitted: PlanningState, stage: PlanningStage): void {
  const expected = stage === "foundation" ? ["foundation"] : [...(current?.completedStages ?? []), stage]
  if (JSON.stringify(submitted.completedStages) !== JSON.stringify(expected)) throw new Error("A planning draft may submit only the requested stage.")
}

function projectPlanFromState(state: PlanningState): ProjectPlan | undefined {
  if (!state.vision || !state.constitution || !state.architecture || !state.roadmap || !state.epics) return undefined
  return { vision: state.vision, constitution: state.constitution, architecture: state.architecture, roadmap: state.roadmap, epics: state.epics, relationships: state.relationships }
}
