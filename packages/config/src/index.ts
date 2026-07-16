import {
  ConfigurationError,
  isRecord,
  type Workspace,
  type WorkflowConfiguration,
} from "@specta/core"
import type { FileSystem } from "@specta/filesystem"
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
  return {
    skillTargets,
    manifestPath: ".specta/workflows/manifest.json",
  }
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
      await fileSystem.writeText(
        workspaceManifestPath(workspace.rootPath),
        `${JSON.stringify(workspace, null, 2)}\n`,
      )
    },
  }
}

function parseWorkspace(value: unknown, manifestPath: string): Workspace {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.id !== "string" ||
      typeof value.rootPath !== "string" || typeof value.createdAt !== "string" ||
      !Array.isArray(value.projects) || !isRecord(value.artifacts) ||
      !["npm", "pnpm", "yarn", "unknown"].includes(String(value.packageManager))) {
    throw new ConfigurationError(`Specta configuration at ${manifestPath} is invalid.`)
  }
  if (!value.projects.every(isProject)) {
    throw new ConfigurationError(`Specta configuration at ${manifestPath} contains an invalid project.`)
  }
  if (value.workflow !== undefined && !isWorkflowConfiguration(value.workflow) && !isLegacyWorkflowConfiguration(value.workflow)) {
    throw new ConfigurationError("Specta configuration at " + manifestPath + " contains invalid workflow configuration.")
  }
  const workflow = value.workflow === undefined
    ? defaultWorkflowConfiguration()
    : isLegacyWorkflowConfiguration(value.workflow)
      ? defaultWorkflowConfiguration(value.workflow.integrations)
      : value.workflow
  return { ...value, workflow } as unknown as Workspace
}

function isProject(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string" &&
    typeof value.rootPath === "string" && typeof value.manifestPath === "string" &&
    ["application", "library", "package", "service", "unknown"].includes(String(value.kind))
}

function isWorkflowConfiguration(value: unknown): value is WorkflowConfiguration {
  return isRecord(value) && Array.isArray(value.skillTargets) &&
    value.skillTargets.every((target) => typeof target === "string" && target.length > 0) &&
    new Set(value.skillTargets).size === value.skillTargets.length &&
    typeof value.manifestPath === "string" && value.manifestPath === ".specta/workflows/manifest.json"
}

function isLegacyWorkflowConfiguration(value: unknown): value is { integrations: string[] } {
  return isRecord(value) && Array.isArray(value.integrations) &&
    value.integrations.every((integration) => typeof integration === "string" && integration.length > 0)
}
