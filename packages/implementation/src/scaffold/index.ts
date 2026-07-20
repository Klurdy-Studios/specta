import { createHash } from "node:crypto"
import { join } from "node:path"
import {
  scaffoldPlanSchema,
  technicalDesignSchema,
  type ScaffoldPlan,
  type ScaffoldResult,
  type ScaffoldRunId,
  type TechnicalDesign,
  type TechnicalDesignId,
  type Workspace,
} from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { nodeFileSystem } from "@specta/core/filesystem"
import { createFrameworkSkillDiscovery, type FrameworkSkillDiscovery } from "@specta/core/skills"
import {
  createPlanningGraphRepository,
  createScaffoldRunRepository,
  createTechnicalDesignGraphRepository,
  type PlanningGraphRepository,
  type ScaffoldRunRepository,
  type TechnicalDesignGraphRepository,
} from "@specta/graph"
import { createTechnicalDependencyResolver, type TechnicalDependencyResolver } from "../dependencies/index.ts"
import { createLanguageAdapterRegistry, type LanguageAdapterRegistry } from "../language/index.ts"
import { createBootstrapPlan } from "../project-profile/index.ts"
import { runAtomically } from "../transaction.ts"

export interface PrepareScaffoldRequest {
  workspace: Workspace
  designId: TechnicalDesignId
}

export interface FinalizeScaffoldRequest {
  workspace: Workspace
  scaffoldRunId: ScaffoldRunId
}

export interface ScaffoldWorkflow {
  prepare(request: PrepareScaffoldRequest): Promise<ScaffoldPlan>
  finalize(request: FinalizeScaffoldRequest): Promise<ScaffoldResult>
}

export interface ScaffoldWorkflowOptions {
  designs?: TechnicalDesignGraphRepository
  runs?: ScaffoldRunRepository
  planning?: PlanningGraphRepository
  dependencies?: TechnicalDependencyResolver
  languages?: LanguageAdapterRegistry
  skills?: FrameworkSkillDiscovery
  fileSystem?: FileSystem
}

export function createScaffoldWorkflow(options: ScaffoldWorkflowOptions = {}): ScaffoldWorkflow {
  const fileSystem = options.fileSystem ?? nodeFileSystem
  const designs = options.designs ?? createTechnicalDesignGraphRepository(fileSystem)
  const runs = options.runs ?? createScaffoldRunRepository(fileSystem)
  const planning = options.planning ?? createPlanningGraphRepository(fileSystem)
  const dependencies = options.dependencies ?? createTechnicalDependencyResolver()
  const languages = options.languages ?? createLanguageAdapterRegistry()
  const skills = options.skills ?? createFrameworkSkillDiscovery(fileSystem)

  async function prepare({ workspace, designId }: PrepareScaffoldRequest): Promise<ScaffoldPlan> {
    const design = await requireApprovedDesign(workspace, designId, designs)
    await requireLatestRevision(workspace, design, designs)
    await requireAvailableDependencies(workspace, design, designs, planning, dependencies)
    const expectedFiles = design.modules.flatMap((module) => module.files)
    const existingFiles: ScaffoldPlan["existingFiles"] = []
    const protectedPaths = new Set([
      ...expectedFiles.map((file) => file.path),
      "package.json",
      "tsconfig.json",
      ...design.profile.evidence
        .filter((evidence) => evidence.kind === "configuration")
        .map((evidence) => evidence.source.replace(/^\.\//, "")),
    ])
    for (const relativePath of protectedPaths) {
      const path = sourcePath(workspace, design, relativePath)
      if (await fileSystem.exists(path)) {
        existingFiles.push({ path: relativePath, hash: contentHash(await fileSystem.readText(path)) })
      }
    }
    const id = scaffoldRunId(design, existingFiles)
    const bootstrap = createBootstrapPlan(design.profile, design.id)
    const skillDiscovery = design.profile.state === "blank" && design.profile.framework !== "none"
      ? await skills.discover(workspace, design.profile.framework)
      : undefined
    const plan = scaffoldPlanSchema.parse({
      id,
      designId: design.id,
      designRevision: design.revision,
      status: "prepared",
      profile: design.profile,
      ...(bootstrap === undefined ? {} : { bootstrap }),
      expectedFiles,
      existingFiles,
      ...(skillDiscovery === undefined ? {} : { skillDiscovery }),
    })
    await runs.save(workspace, plan)
    return plan
  }

  async function finalize({ workspace, scaffoldRunId }: FinalizeScaffoldRequest): Promise<ScaffoldResult> {
    const plan = await runs.get(workspace, scaffoldRunId)
    if (plan === null) throw new Error("Scaffold run not found: " + scaffoldRunId + ".")
    if (plan.status !== "prepared") throw new Error("Scaffold run must be prepared before finalization.")
    const design = await requireApprovedDesign(workspace, plan.designId, designs)
    await requireLatestRevision(workspace, design, designs)
    if (design.revision !== plan.designRevision) throw new Error("Scaffold plan is stale because the Technical Design changed.")
    await requireAvailableDependencies(workspace, design, designs, planning, dependencies)
    if (plan.bootstrap !== undefined) {
      for (const manifest of plan.bootstrap.expectedManifests) {
        const path = join(workspace.rootPath, plan.profile.rootPath, manifest)
        if (!(await fileSystem.exists(path))) throw new Error("Framework bootstrap is incomplete; missing " + manifest + ".")
      }
    }
    for (const baseline of plan.existingFiles) {
      const path = sourcePath(workspace, design, baseline.path)
      if (!(await fileSystem.exists(path)) || contentHash(await fileSystem.readText(path)) !== baseline.hash) {
        throw new Error("Scaffolding must preserve existing file: " + baseline.path + ".")
      }
    }
    const preserved = new Set(plan.existingFiles.map((file) => file.path))
    const expected = new Set(plan.expectedFiles.map((file) => file.path))
    const createdPaths: string[] = []
    for (const file of plan.expectedFiles) {
      const path = sourcePath(workspace, design, file.path)
      if (!(await fileSystem.exists(path))) throw new Error("Agent-created scaffold file is missing: " + file.path + ".")
      if (preserved.has(file.path) && file.ownership === "epic") {
        const validation = languages.resolve(file.language).validateFile(
          file,
          await fileSystem.readText(path),
          { declarationOnly: false },
        )
        if (!validation.valid) throw new Error(validation.summary + " " + validation.issues.join(" "))
      } else if (file.ownership === "epic") {
        const validation = languages.resolve(file.language).validateFile(file, await fileSystem.readText(path))
        if (!validation.valid) throw new Error(validation.summary + " " + validation.issues.join(" "))
        createdPaths.push(file.path)
      }
    }
    return complete(
      workspace,
      design,
      plan,
      createdPaths,
      [...preserved],
      [...preserved].filter((path) => expected.has(path)),
      designs,
      runs,
      fileSystem,
    )
  }

  return {
    prepare,
    finalize,
  }
}

async function requireLatestRevision(
  workspace: Workspace,
  design: TechnicalDesign,
  repository: TechnicalDesignGraphRepository,
): Promise<void> {
  const latest = (await repository.list(workspace))
    .filter((candidate) => candidate.targetId === design.targetId)
    .reduce((highest, candidate) => Math.max(highest, candidate.revision), 0)
  if (design.revision !== latest) throw new Error("Only the latest Technical Design revision can be scaffolded.")
}

async function requireApprovedDesign(
  workspace: Workspace,
  designId: TechnicalDesignId,
  repository: TechnicalDesignGraphRepository,
): Promise<TechnicalDesign> {
  const design = await repository.get(workspace, designId)
  if (design === null) throw new Error("Technical Design not found: " + designId + ".")
  if (design.status !== "approved") throw new Error("Technical Design must be approved before scaffolding.")
  return design
}

async function requireAvailableDependencies(
  workspace: Workspace,
  design: TechnicalDesign,
  repository: TechnicalDesignGraphRepository,
  planning: PlanningGraphRepository,
  resolver: TechnicalDependencyResolver,
): Promise<void> {
  const state = await planning.loadPlanningState(workspace)
  if (state === null) throw new Error("Scaffolding requires planning state.")
  const resolution = resolver.resolve(design, await repository.list(workspace), state)
  if (resolution.some((dependency) => dependency.status !== "available")) {
    throw new Error("Scaffolding requires all cross-Epic dependencies to be available.")
  }
}

async function complete(
  workspace: Workspace,
  design: TechnicalDesign,
  plan: ScaffoldPlan,
  createdPaths: string[],
  preservedPaths: string[],
  preservedDesignPaths: string[],
  designs: TechnicalDesignGraphRepository,
  runs: ScaffoldRunRepository,
  fileSystem: FileSystem,
): Promise<ScaffoldResult> {
  const scaffoldedPaths = [...new Set([...(design.scaffoldedPaths ?? []), ...createdPaths, ...preservedDesignPaths])]
  await runAtomically(fileSystem, [
    join(workspace.rootPath, ".specta", "graph", "technical-designs.json"),
    join(workspace.rootPath, ".specta", "graph", "scaffold-runs.json"),
  ], async () => {
    await designs.save(workspace, technicalDesignSchema.parse({ ...design, status: "scaffolded", scaffoldedPaths }))
    await runs.save(workspace, { ...plan, status: "finalized" })
  })
  return { designId: design.id, scaffoldRunId: plan.id, createdPaths, preservedPaths, workspace }
}

function sourcePath(workspace: Workspace, design: TechnicalDesign, path: string): string {
  return join(workspace.rootPath, design.profile.rootPath, path)
}

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

function scaffoldRunId(design: TechnicalDesign, existing: ScaffoldPlan["existingFiles"]): ScaffoldRunId {
  return ("scaffold_" + createHash("sha256")
    .update(design.id + ":" + design.revision + ":" + JSON.stringify(existing))
    .digest("hex").slice(0, 16)) as ScaffoldRunId
}
