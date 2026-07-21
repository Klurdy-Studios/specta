import { join } from "node:path"
import { z } from "zod"
import {
  projectProfileSchema,
  scaffoldPlanSchema,
  type Workspace,
} from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { analysisGraphSnapshotSchema } from "../analysis/snapshot.ts"
import { parsePlanningGraphSnapshot } from "./planning-snapshot.ts"
import { technicalDesignGraphSnapshotSchema } from "../implementation.ts"
import type { GraphProjection } from "../repository/contracts.ts"
import {
  analysisProjection,
  planningStateProjection,
  projectProfilesProjection,
  scaffoldRunsProjection,
  technicalDesignsProjection,
} from "../updates/domain-projections.ts"

const projectProfilesEnvelope = z.object({
  schemaVersion: z.literal(1),
  profiles: z.array(projectProfileSchema),
  nodes: z.array(z.unknown()),
}).strict()
const scaffoldRunsEnvelope = z.object({
  schemaVersion: z.literal(1),
  runs: z.array(scaffoldPlanSchema),
  nodes: z.array(z.unknown()),
}).strict()

/** Reads existing JSON shards into validated projections for one-time SQLite migration. */
export async function collectLegacyGraphProjections(
  workspace: Workspace,
  fileSystem: FileSystem,
): Promise<GraphProjection[]> {
  const root = join(workspace.rootPath, ".specta", "graph")
  const projections: GraphProjection[] = []
  const planning = await readJson(fileSystem, join(root, "planning-relationships.json"))
  if (planning !== null) projections.push(planningStateProjection(parsePlanningGraphSnapshot(planning).planning))
  const designs = await readJson(fileSystem, join(root, "technical-designs.json"))
  if (designs !== null) projections.push(technicalDesignsProjection(technicalDesignGraphSnapshotSchema.parse(designs).designs))
  const profiles = await readJson(fileSystem, join(root, "project-profiles.json"))
  if (profiles !== null) projections.push(projectProfilesProjection(projectProfilesEnvelope.parse(profiles).profiles))
  const runs = await readJson(fileSystem, join(root, "scaffold-runs.json"))
  if (runs !== null) projections.push(scaffoldRunsProjection(scaffoldRunsEnvelope.parse(runs).runs))
  const analysis = await readJson(fileSystem, join(root, "analysis.json"))
  if (analysis !== null) projections.push(analysisProjection(analysisGraphSnapshotSchema.parse(analysis)))
  return projections
}

async function readJson(fileSystem: FileSystem, path: string): Promise<unknown | null> {
  if (!(await fileSystem.exists(path))) return null
  try {
    return JSON.parse(await fileSystem.readText(path))
  } catch (error) {
    throw new Error("Unable to migrate legacy graph shard " + path + ".", { cause: error })
  }
}
