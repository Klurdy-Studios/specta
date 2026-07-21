import { planningStateSchema, type PlanningState, type Workspace } from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { nodeFileSystem } from "@specta/core/filesystem"
import { createSqliteWorkspaceGraphProvider } from "../persistence/sqlite.ts"
import { planningStateProjection } from "../updates/domain-projections.ts"
import type { WorkspaceGraphProvider } from "./contracts.ts"

/** Validated read/write access to canonical planning state. */
export interface PlanningGraphRepository {
  loadPlanningState(workspace: Workspace): Promise<PlanningState | null>
  savePlanningState(workspace: Workspace, state: PlanningState): Promise<void>
}

/** Creates the canonical planning-state repository backed by the Workspace Graph. */
export function createPlanningGraphRepository(
  fileSystem: FileSystem = nodeFileSystem,
  provider: WorkspaceGraphProvider = createSqliteWorkspaceGraphProvider({ fileSystem }),
): PlanningGraphRepository {
  return {
    async loadPlanningState(workspace) {
      try {
        return await provider.withGraph(workspace, async (graph) => {
          const value = await graph.readDocument<unknown>("planning-state")
          return value === null ? null : planningStateSchema.parse(value)
        })
      } catch (error) {
        throw new Error("Unable to read planning state from the Workspace Graph.", { cause: error })
      }
    },
    async savePlanningState(workspace, state) {
      const validated = planningStateSchema.parse(state)
      await provider.withGraph(workspace, async (graph) => graph.projections.apply(planningStateProjection(validated)))
    },
  }
}
