import type { Workspace } from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { nodeFileSystem } from "@specta/core/filesystem"
import { createSqliteWorkspaceGraphProvider } from "./persistence/sqlite.ts"
import type { EligibleEpic, WorkspaceGraphProvider } from "./repository/contracts.ts"

export type ImplementationEpicSelector =
  | { kind: "epic"; epicId: string }
  | { kind: "next" }

/** Resolves an implementation candidate using roadmap order and graph prerequisites. */
export interface ImplementationEligibilityResolver {
  resolve(workspace: Workspace, selector: ImplementationEpicSelector): Promise<EligibleEpic>
}

/** Creates deterministic graph-backed Epic eligibility resolution. */
export function createImplementationEligibilityResolver(
  fileSystem: FileSystem = nodeFileSystem,
  provider: WorkspaceGraphProvider = createSqliteWorkspaceGraphProvider({ fileSystem }),
): ImplementationEligibilityResolver {
  return {
    async resolve(workspace, selector) {
      const candidate = await provider.withGraph(workspace, (graph) => selector.kind === "next"
        ? graph.queries.nextEligibleEpic()
        : graph.queries.eligibleEpic(selector.epicId))
      if (candidate) return candidate
      if (selector.kind === "next") {
        throw new Error("No eligible Epic is available. Complete prerequisites and finalized scaffolding first.")
      }
      throw new Error(
        "Epic is not eligible for implementation: " + selector.epicId
        + ". Complete its prerequisites and finalized scaffolding first.",
      )
    },
  }
}
