import {
  projectProfileSchema,
  scaffoldPlanSchema,
  technicalDesignSchema,
  type ProjectProfile,
  type ScaffoldPlan,
  type ScaffoldRunId,
  type TechnicalDesign,
  type TechnicalDesignId,
  type Workspace,
} from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { nodeFileSystem } from "@specta/core/filesystem"
import { z } from "zod"
import { createSqliteWorkspaceGraphProvider } from "./persistence/sqlite.ts"
import type { WorkspaceGraphProvider } from "./repository/contracts.ts"
import {
  projectProfilesProjection,
  scaffoldRunsProjection,
  technicalDesignsProjection,
} from "./updates/domain-projections.ts"

const implementationNodeSchema = z.object({
  id: z.string(),
  type: z.enum(["TECHNICAL_DESIGN", "MODULE", "FILE", "CODE_SYMBOL"]),
}).strict()
const implementationRelationshipSchema = z.object({
  type: z.enum(["CONTAINS", "DEPENDS_ON", "IMPLEMENTS"]),
  sourceId: z.string(),
  targetId: z.string(),
}).strict()
export const technicalDesignGraphSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  designs: z.array(technicalDesignSchema),
  nodes: z.array(implementationNodeSchema),
  relationships: z.array(implementationRelationshipSchema),
}).strict()

/** Validated persistence for immutable Technical Design revisions. */
export interface TechnicalDesignGraphRepository {
  list(workspace: Workspace): Promise<TechnicalDesign[]>
  get(workspace: Workspace, designId: TechnicalDesignId): Promise<TechnicalDesign | null>
  save(workspace: Workspace, design: TechnicalDesign): Promise<void>
  saveMany(workspace: Workspace, designs: TechnicalDesign[]): Promise<void>
  /** Atomically persists Technical Designs and their resolved project profiles. */
  saveDesignsAndProfiles(workspace: Workspace, designs: TechnicalDesign[], profiles: ProjectProfile[]): Promise<void>
}

/** Validated persistence for detected or design-declared project profiles. */
export interface ProjectProfileRepository {
  list(workspace: Workspace): Promise<ProjectProfile[]>
  save(workspace: Workspace, profile: ProjectProfile): Promise<void>
}

/** Validated persistence for scaffold prepare/finalize runs. */
export interface ScaffoldRunRepository {
  get(workspace: Workspace, runId: ScaffoldRunId): Promise<ScaffoldPlan | null>
  save(workspace: Workspace, plan: ScaffoldPlan): Promise<void>
  /** Atomically finalizes a scaffold run and its Technical Design. */
  saveWithDesign(workspace: Workspace, plan: ScaffoldPlan, design: TechnicalDesign): Promise<void>
}

/** Persists validated Epic technical designs as a Workspace Graph shard. */
export function createTechnicalDesignGraphRepository(
  fileSystem: FileSystem = nodeFileSystem,
  provider: WorkspaceGraphProvider = createSqliteWorkspaceGraphProvider({ fileSystem }),
): TechnicalDesignGraphRepository {
  return {
    async list(workspace) {
      try {
        return await provider.withGraph(workspace, async (graph) => {
          const value = await graph.readDocument<unknown>("technical-designs")
          return value === null ? [] : z.array(technicalDesignSchema).parse(value)
        })
      } catch (error) {
        throw new Error("Unable to read technical designs from the Workspace Graph.", { cause: error })
      }
    },
    async get(workspace, designId) {
      return (await this.list(workspace)).find((design) => design.id === designId) ?? null
    },
    async save(workspace, design) {
      await this.saveMany(workspace, [design])
    },
    async saveMany(workspace, batch) {
      await this.saveDesignsAndProfiles(workspace, batch, [])
    },
    async saveDesignsAndProfiles(workspace, batch, profileBatch) {
      const validated = batch.map((design) => technicalDesignSchema.parse(design))
      const validatedProfiles = profileBatch.map((profile) => projectProfileSchema.parse(profile))
      await provider.withGraph(workspace, (graph) => graph.transaction(async (transaction) => {
        const designValue = await transaction.readDocument<unknown>("technical-designs")
        const profileValue = await transaction.readDocument<unknown>("project-profiles")
        const current = designValue === null ? [] : z.array(technicalDesignSchema).parse(designValue)
        const currentProfiles = profileValue === null ? [] : z.array(projectProfileSchema).parse(profileValue)
        const ids = new Set(validated.map((design) => design.id))
        const profileKeys = new Set(validatedProfiles.map(profileCollectionKey))
        const designs = [...current.filter((item) => !ids.has(item.id)), ...validated]
        const profiles = [...currentProfiles.filter((item) => !profileKeys.has(profileCollectionKey(item))), ...validatedProfiles]
        const projections = [technicalDesignsProjection(designs)]
        if (validatedProfiles.length > 0) projections.unshift(projectProfilesProjection(profiles))
        await transaction.projections.applyMany(projections)
      }))
    },
  }
}

/** Persists deterministic project and framework discovery evidence. */
export function createProjectProfileRepository(
  fileSystem: FileSystem = nodeFileSystem,
  provider: WorkspaceGraphProvider = createSqliteWorkspaceGraphProvider({ fileSystem }),
): ProjectProfileRepository {
  return {
    async list(workspace) {
      return provider.withGraph(workspace, async (graph) => {
        const value = await graph.readDocument<unknown>("project-profiles")
        return value === null ? [] : z.array(projectProfileSchema).parse(value)
      })
    },
    async save(workspace, profile) {
      const validated = projectProfileSchema.parse(profile)
      await provider.withGraph(workspace, (graph) => graph.transaction(async (transaction) => {
        const value = await transaction.readDocument<unknown>("project-profiles")
        const current = value === null ? [] : z.array(projectProfileSchema).parse(value)
        const key = profileCollectionKey(validated)
        const profiles = [...current.filter((item) => profileCollectionKey(item) !== key), validated]
        await transaction.projections.apply(projectProfilesProjection(profiles))
      }))
    },
  }
}

/** Persists prepare/finalize scaffold runs so preservation checks cannot be skipped. */
export function createScaffoldRunRepository(
  fileSystem: FileSystem = nodeFileSystem,
  provider: WorkspaceGraphProvider = createSqliteWorkspaceGraphProvider({ fileSystem }),
): ScaffoldRunRepository {
  return {
    async get(workspace, runId) {
      return provider.withGraph(workspace, async (graph) => {
        const value = await graph.readDocument<unknown>("scaffold-runs")
        return value === null ? null : z.array(scaffoldPlanSchema).parse(value).find((run) => run.id === runId) ?? null
      })
    },
    async save(workspace, plan) {
      const validated = scaffoldPlanSchema.parse(plan)
      await provider.withGraph(workspace, (graph) => graph.transaction(async (transaction) => {
        const value = await transaction.readDocument<unknown>("scaffold-runs")
        const current = value === null ? [] : z.array(scaffoldPlanSchema).parse(value)
        const runs = [...current.filter((run) => run.id !== validated.id), validated]
        await transaction.projections.apply(scaffoldRunsProjection(runs))
      }))
    },
    async saveWithDesign(workspace, plan, design) {
      const validatedPlan = scaffoldPlanSchema.parse(plan)
      const validatedDesign = technicalDesignSchema.parse(design)
      await provider.withGraph(workspace, (graph) => graph.transaction(async (transaction) => {
        const runValue = await transaction.readDocument<unknown>("scaffold-runs")
        const designValue = await transaction.readDocument<unknown>("technical-designs")
        const currentRuns = runValue === null ? [] : z.array(scaffoldPlanSchema).parse(runValue)
        const currentDesigns = designValue === null ? [] : z.array(technicalDesignSchema).parse(designValue)
        const runs = [...currentRuns.filter((run) => run.id !== validatedPlan.id), validatedPlan]
        const designs = [...currentDesigns.filter((item) => item.id !== validatedDesign.id), validatedDesign]
        await transaction.projections.applyMany([
          technicalDesignsProjection(designs),
          scaffoldRunsProjection(runs),
        ])
      }))
    },
  }
}

function profileCollectionKey(profile: ProjectProfile): string {
  return profile.projectId ?? profile.rootPath
}
