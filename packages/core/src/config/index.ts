import {
  ConfigurationError,
  isRecord,
  workspaceSchema,
  workflowConfigurationSchema,
  type Workspace,
  type WorkflowConfiguration,
} from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { join } from "node:path"

export const SPECTA_DIRECTORY = ".specta"
export const WORKSPACE_MANIFEST = "workspace.json"

export interface WorkspaceRepository {
  load(rootPath: string): Promise<Workspace | null>
  save(workspace: Workspace): Promise<void>
}

export const workspaceManifestPath = (rootPath: string): string =>
  join(rootPath, SPECTA_DIRECTORY, WORKSPACE_MANIFEST)

export function defaultWorkflowConfiguration(skillTargets: string[] = []): WorkflowConfiguration {
  return workflowConfigurationSchema.parse({
    skillTargets,
    manifestPath: ".specta/workflows/manifest.json",
  })
}

export function createWorkspaceRepository(fileSystem: FileSystem): WorkspaceRepository {
  return {
    async load(rootPath) {
      const manifestPath = workspaceManifestPath(rootPath)
      if (!(await fileSystem.exists(manifestPath))) return null

      let parsed: unknown
      try {
        parsed = JSON.parse(await fileSystem.readText(manifestPath))
      } catch (error) {
        throw new ConfigurationError(`Unable to read Specta configuration at ${manifestPath}.`, error)
      }
      return parseWorkspace(parsed, manifestPath)
    },
    async save(workspace) {
      const validated = workspaceSchema.parse(workspace)
      await fileSystem.writeText(
        workspaceManifestPath(workspace.rootPath),
        `${JSON.stringify(validated, null, 2)}\n`,
      )
    },
  }
}

function parseWorkspace(value: unknown, manifestPath: string): Workspace {
  if (!isRecord(value)) throw new ConfigurationError(`Specta configuration at ${manifestPath} is invalid.`)
  const workflow = value.workflow === undefined
    ? defaultWorkflowConfiguration()
    : isLegacyWorkflowConfiguration(value.workflow)
      ? defaultWorkflowConfiguration(value.workflow.integrations)
      : value.workflow
  const result = workspaceSchema.safeParse({ ...value, workflow })
  if (result.success) return result.data
  if (result.error.issues.some((issue) => issue.path[0] === "workflow")) {
    throw new ConfigurationError("Specta configuration at " + manifestPath + " contains invalid workflow configuration.", result.error)
  }
  throw new ConfigurationError(`Specta configuration at ${manifestPath} is invalid.`, result.error)
}

function isLegacyWorkflowConfiguration(value: unknown): value is { integrations: string[] } {
  return isRecord(value) && Array.isArray(value.integrations) &&
    value.integrations.every((integration) => typeof integration === "string" && integration.length > 0)
}
