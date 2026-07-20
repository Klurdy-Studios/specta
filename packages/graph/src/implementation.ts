import { join } from "node:path"
import { createHash } from "node:crypto"
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

const projectProfileCollectionSchema = z.object({
  schemaVersion: z.literal(1),
  profiles: z.array(projectProfileSchema),
  nodes: z.array(z.object({ id: z.string(), type: z.literal("PROJECT_PROFILE") }).strict()),
}).strict()

const scaffoldRunCollectionSchema = z.object({
  schemaVersion: z.literal(1),
  runs: z.array(scaffoldPlanSchema),
  nodes: z.array(z.object({ id: z.string(), type: z.literal("SCAFFOLD_RUN") }).strict()),
}).strict()

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

export interface TechnicalDesignGraphRepository {
  list(workspace: Workspace): Promise<TechnicalDesign[]>
  get(workspace: Workspace, designId: TechnicalDesignId): Promise<TechnicalDesign | null>
  save(workspace: Workspace, design: TechnicalDesign): Promise<void>
  saveMany(workspace: Workspace, designs: TechnicalDesign[]): Promise<void>
}

export interface ProjectProfileRepository {
  list(workspace: Workspace): Promise<ProjectProfile[]>
  save(workspace: Workspace, profile: ProjectProfile): Promise<void>
}

export interface ScaffoldRunRepository {
  get(workspace: Workspace, runId: ScaffoldRunId): Promise<ScaffoldPlan | null>
  save(workspace: Workspace, plan: ScaffoldPlan): Promise<void>
}

/** Persists validated Epic technical designs as a Workspace Graph shard. */
export function createTechnicalDesignGraphRepository(
  fileSystem: FileSystem = nodeFileSystem,
): TechnicalDesignGraphRepository {
  return {
    async list(workspace) {
      const value = await readJson(fileSystem, graphPath(workspace, "technical-designs.json"))
      if (value === null) return []
      try {
        return technicalDesignGraphSnapshotSchema.parse(value).designs
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
      const validated = batch.map((design) => technicalDesignSchema.parse(design))
      const current = await this.list(workspace)
      const ids = new Set(validated.map((design) => design.id))
      const designs = [...current.filter((item) => !ids.has(item.id)), ...validated]
      const projection = projectTechnicalDesigns(designs)
      await writeJson(fileSystem, graphPath(workspace, "technical-designs.json"), {
        schemaVersion: 1,
        designs,
        ...projection,
      })
    },
  }
}

/** Persists deterministic project and framework discovery evidence. */
export function createProjectProfileRepository(
  fileSystem: FileSystem = nodeFileSystem,
): ProjectProfileRepository {
  return {
    async list(workspace) {
      const value = await readJson(fileSystem, graphPath(workspace, "project-profiles.json"))
      return value === null ? [] : projectProfileCollectionSchema.parse(value).profiles
    },
    async save(workspace, profile) {
      const validated = projectProfileSchema.parse(profile)
      const current = await this.list(workspace)
      const key = profileKey(validated)
      const profiles = [...current.filter((item) => profileKey(item) !== key), validated]
      await writeJson(fileSystem, graphPath(workspace, "project-profiles.json"), {
        schemaVersion: 1,
        profiles,
        nodes: profiles.map((item) => ({ id: profileKey(item), type: "PROJECT_PROFILE" as const })),
      })
    },
  }
}

/** Persists prepare/finalize scaffold runs so preservation checks cannot be skipped. */
export function createScaffoldRunRepository(
  fileSystem: FileSystem = nodeFileSystem,
): ScaffoldRunRepository {
  return {
    async get(workspace, runId) {
      const value = await readJson(fileSystem, graphPath(workspace, "scaffold-runs.json"))
      if (value === null) return null
      return scaffoldRunCollectionSchema.parse(value).runs.find((run) => run.id === runId) ?? null
    },
    async save(workspace, plan) {
      const validated = scaffoldPlanSchema.parse(plan)
      const value = await readJson(fileSystem, graphPath(workspace, "scaffold-runs.json"))
      const current = value === null ? [] : scaffoldRunCollectionSchema.parse(value).runs
      await writeJson(fileSystem, graphPath(workspace, "scaffold-runs.json"), {
        schemaVersion: 1,
        runs: [...current.filter((run) => run.id !== validated.id), validated],
        nodes: [...current.filter((run) => run.id !== validated.id), validated]
          .map((run) => ({ id: run.id, type: "SCAFFOLD_RUN" as const })),
      })
    },
  }
}

function projectTechnicalDesigns(designs: TechnicalDesign[]): {
  nodes: Array<z.infer<typeof implementationNodeSchema>>
  relationships: Array<z.infer<typeof implementationRelationshipSchema>>
} {
  const nodes: Array<z.infer<typeof implementationNodeSchema>> = []
  const relationships: Array<z.infer<typeof implementationRelationshipSchema>> = []
  for (const design of designs) {
    nodes.push({ id: design.id, type: "TECHNICAL_DESIGN" })
    relationships.push({ type: "IMPLEMENTS", sourceId: design.id, targetId: design.targetId })
    for (const module of design.modules) {
      const moduleId = entityId(design.id, "module", module.path)
      nodes.push({ id: moduleId, type: "MODULE" })
      relationships.push({ type: "CONTAINS", sourceId: design.id, targetId: moduleId })
      for (const file of module.files) {
        const fileId = entityId(design.id, "file", file.path)
        nodes.push({ id: fileId, type: "FILE" })
        relationships.push({ type: "CONTAINS", sourceId: moduleId, targetId: fileId })
        for (const symbol of file.exports) {
          const symbolId = entityId(design.id, "symbol", file.path + "#" + symbol.name)
          nodes.push({ id: symbolId, type: "CODE_SYMBOL" })
          relationships.push({ type: "CONTAINS", sourceId: fileId, targetId: symbolId })
        }
      }
    }
    for (const dependency of design.dependencies) {
      const targetId = dependency.kind === "technical-design"
        ? dependency.targetDesignId
        : dependency.kind === "file"
          ? entityId(dependency.targetDesignId, "file", dependency.filePath)
          : entityId(dependency.targetDesignId, "symbol", dependency.filePath + "#" + dependency.symbolName)
      relationships.push({ type: "DEPENDS_ON", sourceId: design.id, targetId })
    }
  }
  return { nodes, relationships }
}

function entityId(designId: TechnicalDesignId, kind: string, value: string): string {
  return kind + "_" + createHash("sha256").update(designId + ":" + value).digest("hex").slice(0, 16)
}

function graphPath(workspace: Workspace, name: string): string {
  return join(workspace.rootPath, ".specta", "graph", name)
}

function profileKey(profile: ProjectProfile): string {
  return profile.projectId ?? profile.rootPath
}

async function readJson(fileSystem: FileSystem, path: string): Promise<unknown | null> {
  if (!(await fileSystem.exists(path))) return null
  return JSON.parse(await fileSystem.readText(path)) as unknown
}

function writeJson(fileSystem: FileSystem, path: string, value: unknown): Promise<void> {
  return fileSystem.writeText(path, JSON.stringify(value, null, 2) + "\n")
}
