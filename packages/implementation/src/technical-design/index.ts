import { createHash } from "node:crypto"
import { join } from "node:path"
import {
  technicalDesignDraftSchema,
  technicalDesignSchema,
  type PlanningId,
  type ProjectTarget,
  type TechnicalDesign,
  type TechnicalDesignDraft,
  type TechnicalDesignId,
  type Workspace,
} from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { nodeFileSystem } from "@specta/core/filesystem"
import {
  createPlanningGraphRepository,
  createProjectProfileRepository,
  createTechnicalDesignGraphRepository,
  type PlanningGraphRepository,
  type ProjectProfileRepository,
  type TechnicalDesignGraphRepository,
} from "@specta/graph"
import { createTechnicalDependencyResolver, type TechnicalDependencyResolver } from "../dependencies/index.ts"
import { createLanguageAdapterRegistry, type LanguageAdapterRegistry } from "../language/index.ts"
import { createProjectProfileResolver, validateFrameworkConventions, type ProjectProfileResolver } from "../project-profile/index.ts"
import { runAtomically } from "../transaction.ts"

export interface TechnicalDesignRequest {
  workspace: Workspace
  targetId: PlanningId
  draft: TechnicalDesignDraft
  feedback?: string
}

export interface TechnicalDesignWorkflow {
  execute(request: TechnicalDesignRequest): Promise<TechnicalDesign>
}

export interface TechnicalDesignApprovalWorkflow {
  approve(workspace: Workspace, designId: TechnicalDesignId): Promise<TechnicalDesign>
}

export interface TechnicalDesignWorkflowOptions {
  repository?: TechnicalDesignGraphRepository
  planning?: PlanningGraphRepository
  profiles?: ProjectProfileResolver
  profileRepository?: ProjectProfileRepository
  languages?: LanguageAdapterRegistry
  dependencies?: TechnicalDependencyResolver
  fileSystem?: FileSystem
}

/** Creates immutable, Epic-scoped Technical Design revisions without writing source files. */
export function createTechnicalDesignWorkflow(
  options: TechnicalDesignWorkflowOptions = {},
): TechnicalDesignWorkflow {
  const fileSystem = options.fileSystem ?? nodeFileSystem
  const repository = options.repository ?? createTechnicalDesignGraphRepository(fileSystem)
  const planning = options.planning ?? createPlanningGraphRepository(fileSystem)
  const profiles = options.profiles ?? createProjectProfileResolver(fileSystem)
  const profileRepository = options.profileRepository ?? createProjectProfileRepository(fileSystem)
  const languages = options.languages ?? createLanguageAdapterRegistry()
  return {
    async execute({ workspace, targetId, draft: unvalidatedDraft, feedback }) {
      const draft = technicalDesignDraftSchema.parse(unvalidatedDraft)
      const state = await planning.loadPlanningState(workspace)
      const epic = state?.epics?.find((item) => item.id === targetId)
      if (!state?.architecture || !epic) {
        throw new Error("Design requires an Architecture and an Epic in the Workspace Graph.")
      }
      const target = selectTarget(workspace, draft.target)
      const profile = await profiles.resolve(workspace, target)
      const files = draft.modules.flatMap((module) => module.files)
      const validation = languages.resolve(profile.language).validateDesign(files, profile)
      const frameworkIssues = validateFrameworkConventions(profile, files)
      if (!validation.valid || frameworkIssues.length > 0) {
        throw new Error(validation.summary + " " + [...validation.issues, ...frameworkIssues].join(" "))
      }
      const existing = (await repository.list(workspace)).filter((design) => design.targetId === targetId)
      const revision = existing.reduce((highest, design) => Math.max(highest, design.revision), 0) + 1
      const design = technicalDesignSchema.parse({
        ...draft,
        id: technicalDesignId(targetId, revision),
        targetId,
        status: "draft",
        revision,
        target,
        profile,
        ...(feedback === undefined ? {} : { feedback }),
      })
      const superseded = existing
        .filter((candidate) => candidate.status === "draft" || candidate.status === "approved")
        .map((candidate) => technicalDesignSchema.parse({ ...candidate, status: "superseded" }))
      await runAtomically(fileSystem, [
        join(workspace.rootPath, ".specta", "graph", "technical-designs.json"),
        join(workspace.rootPath, ".specta", "graph", "project-profiles.json"),
        artifactPath(workspace, design),
      ], async () => {
        await profileRepository.save(workspace, profile)
        await repository.saveMany(workspace, [...superseded, design])
        await writeArtifact(workspace, design, fileSystem)
      })
      return design
    },
  }
}

/** Approves only the newest revision after language and dependency validation. */
export function createTechnicalDesignApprovalWorkflow(
  options: TechnicalDesignWorkflowOptions = {},
): TechnicalDesignApprovalWorkflow {
  const fileSystem = options.fileSystem ?? nodeFileSystem
  const repository = options.repository ?? createTechnicalDesignGraphRepository(fileSystem)
  const planning = options.planning ?? createPlanningGraphRepository(fileSystem)
  const languages = options.languages ?? createLanguageAdapterRegistry()
  const dependencies = options.dependencies ?? createTechnicalDependencyResolver()
  return {
    async approve(workspace, designId) {
      const design = await repository.get(workspace, designId)
      if (design === null) throw new Error("Technical Design not found: " + designId + ".")
      if (design.status === "scaffolded") throw new Error("A scaffolded Technical Design cannot be approved again.")
      if (design.status === "approved") return design
      const designs = await repository.list(workspace)
      const latest = designs.filter((candidate) => candidate.targetId === design.targetId)
        .reduce((highest, candidate) => Math.max(highest, candidate.revision), 0)
      if (design.revision !== latest) throw new Error("Only the latest Technical Design revision can be approved.")
      const state = await planning.loadPlanningState(workspace)
      if (state === null) throw new Error("Technical Design approval requires planning state.")
      const languageValidation = languages.resolve(design.profile.language)
        .validateDesign(design.modules.flatMap((module) => module.files), design.profile)
      if (!languageValidation.valid) throw new Error(languageValidation.summary + " " + languageValidation.issues.join(" "))
      const resolution = dependencies.resolve(design, designs, state)
      if (resolution.some((item) => item.status === "blocked")) {
        throw new Error("Technical Design has unresolved dependencies: " +
          resolution.filter((item) => item.status === "blocked").map((item) => item.reason).join(" "))
      }
      const approved = technicalDesignSchema.parse({ ...design, status: "approved", resolution })
      await runAtomically(fileSystem, [
        join(workspace.rootPath, ".specta", "graph", "technical-designs.json"),
        artifactPath(workspace, approved),
      ], async () => {
        await repository.save(workspace, approved)
        await writeArtifact(workspace, approved, fileSystem)
      })
      return approved
    },
  }
}

function selectTarget(workspace: Workspace, requested: ProjectTarget | undefined): ProjectTarget {
  if (requested !== undefined) return requested
  if (workspace.projects.length === 1) return { kind: "existing", projectId: workspace.projects[0]!.id }
  if (workspace.projects.length > 1) throw new Error("Technical Design must identify its target project in a multi-project Workspace.")
  throw new Error("A blank Workspace requires an explicit new-project target with language, framework, and toolchain.")
}

function technicalDesignId(epicId: PlanningId, revision: number): TechnicalDesignId {
  return ("design_" + createHash("sha256").update(String(epicId) + ":" + revision).digest("hex").slice(0, 16)) as TechnicalDesignId
}

async function writeArtifact(workspace: Workspace, design: TechnicalDesign, fileSystem: FileSystem): Promise<void> {
  const modules = design.modules.flatMap((module) => [
    "### " + module.name,
    "",
    module.purpose,
    "",
    ...module.files.map((file) =>
      "- " + file.path + " — " + (file.exports.map((symbol) => symbol.name).join(", ") || "no exports")),
  ])
  const dependencies = design.resolution?.map((item) =>
    "- " + item.dependency.kind + " → " + item.dependency.targetDesignId + " (" + item.status + ")",
  ) ?? []
  const content = [
    "# Technical Design " + design.id,
    "",
    "Status: " + design.status,
    "Revision: " + design.revision,
    "Epic: " + design.targetId,
    "Target: " + design.profile.rootPath + " (" + design.profile.framework + "/" + design.profile.language + ")",
    "",
    "## Summary",
    "",
    design.summary,
    "",
    "## Modules",
    "",
    ...modules,
    "",
    "## Dependencies",
    "",
    ...(dependencies.length === 0 ? ["None."] : dependencies),
    "",
  ].join("\n")
  await fileSystem.writeText(artifactPath(workspace, design), content)
}

function artifactPath(workspace: Workspace, design: TechnicalDesign): string {
  return join(workspace.rootPath, ".specta", "designs", String(design.id) + ".md")
}
