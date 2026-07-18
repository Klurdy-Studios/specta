import { createHash } from "node:crypto"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type {
  PlanningId,
  ScaffoldResult,
  TechnicalDependency,
  TechnicalDesign,
  TechnicalModule,
  Workspace,
} from "@specta/core"
import { technicalDesignCollectionSchema, technicalDesignSchema } from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { nodeFileSystem } from "@specta/core/filesystem"
import type { WorkflowModule } from "@specta/core/workflow"
import { createPlanningGraphRepository, type PlanningGraphRepository } from "@specta/graph"

export interface TechnicalDesignRequest {
  workspace: Workspace
  targetId: PlanningId
  draft: TechnicalDesignDraft
  feedback?: string
}

export interface TechnicalDesignDraft {
  summary: string
  modules: TechnicalModule[]
  dependencies: TechnicalDependency[]
  impactRequests: TechnicalDesign["impactRequests"]
}

export interface TechnicalDesignRepository {
  list(workspace: Workspace): Promise<TechnicalDesign[]>
  save(workspace: Workspace, design: TechnicalDesign): Promise<void>
  get(workspace: Workspace, designId: PlanningId): Promise<TechnicalDesign | null>
}

export interface TechnicalDesignWorkflow {
  execute(request: TechnicalDesignRequest): Promise<TechnicalDesign>
}

export interface TechnicalDesignApprovalWorkflow {
  approve(workspace: Workspace, designId: PlanningId): Promise<TechnicalDesign>
}

export interface ScaffoldWorkflowRequest {
  workspace: Workspace
  designId: PlanningId
}

export interface ScaffoldWorkflow {
  execute(request: ScaffoldWorkflowRequest): Promise<ScaffoldResult>
}

export const implementationWorkflowModule: WorkflowModule = {
  definitions: [
    implementationWorkflow("design", "Create a reviewable technical design for one Epic.", ["architecture", "epics"], ["technical-design"], ["resolve-epic", "generate-technical-design", "persist-technical-design"], "target-id", "The Epic to design."),
    implementationWorkflow("approve-design", "Approve a reviewed technical design.", ["technical-design"], ["approved-technical-design"], ["resolve-technical-design", "validate-dependencies", "approve-technical-design"], "design-id", "The Technical Design to approve."),
    implementationWorkflow("scaffold", "Create folders and declaration-only code skeletons from an approved technical design.", ["approved-technical-design"], ["scaffolded-structure"], ["resolve-technical-design", "validate-dependencies", "apply-scaffold", "update-workspace-graph"], "design-id", "The approved Technical Design to scaffold."),
  ],
  promptDirectory: fileURLToPath(new URL("../templates/prompts", import.meta.url)),
  skillDirectory: fileURLToPath(new URL("../templates/skills", import.meta.url)),
}

/** Stores technical-design revisions as a graph-owned collection. */
export function createTechnicalDesignRepository(
  fileSystem: FileSystem = nodeFileSystem,
): TechnicalDesignRepository {
  return {
    async list(workspace) {
      const path = graphPath(workspace)
      if (!(await fileSystem.exists(path))) return []
      try {
        return technicalDesignCollectionSchema.parse(JSON.parse(await fileSystem.readText(path))).designs
      } catch (error) {
        throw new Error("Unable to read technical designs from the Workspace Graph.", { cause: error })
      }
    },
    async save(workspace, design) {
      const validatedDesign = technicalDesignSchema.parse(design)
      const designs = await this.list(workspace)
      const updated = [...designs.filter((item) => item.id !== validatedDesign.id), validatedDesign]
      await fileSystem.writeText(graphPath(workspace), JSON.stringify({ designs: updated }, null, 2) + "\n")
      await fileSystem.writeText(
        join(workspace.rootPath, ".specta", "designs", String(validatedDesign.id) + ".md"),
        renderDesign(validatedDesign),
      )
    },
    async get(workspace, designId) {
      return (await this.list(workspace)).find((design) => design.id === designId) ?? null
    },
  }
}

/** Produces a reviewable technical design for one Epic without creating source files. */
export function createTechnicalDesignWorkflow(
  repository: TechnicalDesignRepository = createTechnicalDesignRepository(),
  planning: PlanningGraphRepository = createPlanningGraphRepository(),
): TechnicalDesignWorkflow {
  return {
    async execute({ workspace, targetId, draft, feedback }) {
      const state = await planning.loadPlanningState(workspace)
      const epic = state?.epics?.find((item) => item.id === targetId)
      if (!state?.architecture || !epic) throw new Error("Design requires an Architecture and an Epic in the Workspace Graph.")
      const existing = (await repository.list(workspace)).filter((design) => design.targetId === targetId)
      const revision = existing.reduce((highest, design) => Math.max(highest, design.revision), 0) + 1
      const design: TechnicalDesign = {
        id: designId(epic.id, revision), targetId: epic.id, status: "draft", revision,
        summary: draft.summary, modules: draft.modules, dependencies: draft.dependencies,
        impactRequests: draft.impactRequests, ...(feedback === undefined ? {} : { feedback }),
      }
      await repository.save(workspace, design)
      return design
    },
  }
}

/** Marks a reviewed design as approved after resolving its declared dependencies. */
export function createTechnicalDesignApprovalWorkflow(
  repository: TechnicalDesignRepository = createTechnicalDesignRepository(),
): TechnicalDesignApprovalWorkflow {
  return {
    async approve(workspace, designId) {
      const design = await repository.get(workspace, designId)
      if (!design) throw new Error("Technical Design not found: " + designId + ".")
      const designs = await repository.list(workspace)
      const dependencies = resolveDependencies(design.dependencies, designs)
      if (dependencies.some((dependency) => dependency.status === "blocked")) {
        throw new Error("Technical Design has unresolved dependencies.")
      }
      const approved: TechnicalDesign = { ...design, status: "approved", dependencies }
      await repository.save(workspace, approved)
      return approved
    },
  }
}

/** Applies only the declarations and folders owned by an approved technical design. */
export function createScaffoldWorkflow(
  repository: TechnicalDesignRepository = createTechnicalDesignRepository(),
  fileSystem: FileSystem = nodeFileSystem,
): ScaffoldWorkflow {
  return {
    async execute({ workspace, designId }) {
      const design = await repository.get(workspace, designId)
      if (!design) throw new Error("Technical Design not found: " + designId + ".")
      if (design.status !== "approved") throw new Error("Technical Design must be approved before scaffolding.")
      const dependencies = resolveDependencies(design.dependencies, await repository.list(workspace))
      if (dependencies.some((dependency) => dependency.status !== "available")) {
        throw new Error("Scaffolding requires all technical dependencies to be available.")
      }
      const createdPaths: string[] = []
      const preservedPaths: string[] = []
      for (const file of design.modules.flatMap((module) => module.files)) {
        const target = join(workspace.rootPath, file.path)
        if (!(await fileSystem.exists(target))) throw new Error("Agent-created scaffold file is missing: " + file.path + ".")
        createdPaths.push(file.path)
      }
      const updated: TechnicalDesign = { ...design, dependencies, scaffoldedPaths: [...(design.scaffoldedPaths ?? []), ...createdPaths] }
      await repository.save(workspace, updated)
      return { designId, createdPaths, preservedPaths, workspace }
    },
  }
}


function resolveDependencies(dependencies: TechnicalDependency[], designs: TechnicalDesign[]): TechnicalDependency[] {
  return dependencies.map((dependency) => {
    const target = designs.find((design) => design.id === dependency.targetId)
    if (!target || target.status !== "approved") return { ...dependency, status: "blocked" }
    return { ...dependency, status: target.scaffoldedPaths && target.scaffoldedPaths.length > 0 ? "available" : "planned" }
  })
}

function renderDesign(design: TechnicalDesign): string {
  const modules = design.modules.flatMap((module) => [
    "### " + module.name,
    module.purpose,
    ...module.files.map((file) => "- " + file.path + ": " + file.exports.map((symbol) => symbol.name).join(", ")),
  ])
  return ["# " + design.id, "", "Status: " + design.status, "Revision: " + design.revision, "", "## Summary", design.summary, "", "## Modules", ...modules, ""].join("\n")
}

function graphPath(workspace: Workspace): string {
  return join(workspace.rootPath, ".specta", "graph", "technical-designs.json")
}

function designId(targetId: PlanningId, revision: number): PlanningId {
  return ("design_" + createHash("sha256").update(String(targetId) + ":" + revision).digest("hex").slice(0, 16)) as PlanningId
}

function implementationWorkflow(
  name: string,
  description: string,
  requires: string[],
  produces: string[],
  executionSteps: string[],
  parameterName: string,
  parameterDescription: string,
): import("@specta/core").WorkflowDefinition {
  return {
    name,
    description,
    parameters: [{ name: parameterName, description: parameterDescription, required: true }],
    requires,
    produces,
    executionSteps,
    promptTemplate: ".specta/workflows/prompts/" + name + ".md",
    artifactTemplates: [],
    completionCriteria: produces.map((artifact) => artifact + " is generated and linked to the Workspace Graph."),
    validationRequirements: ["workflow-state"],
  }
}
