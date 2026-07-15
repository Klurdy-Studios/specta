import {
  ConfigurationError,
  isRecord,
  type Workspace,
  type WorkflowConfiguration,
  type WorkflowTemplateId,
  workflowTemplateIds,
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

export function defaultWorkflowConfiguration(integrations: string[] = []): WorkflowConfiguration {
  return {
    integrations,
    templateSetVersion: 1,
    templates: workflowTemplateIds.map((id) => ({
      id,
      path: ".specta/workflows/" + id + ".md",
      version: 1,
    })),
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
  if (value.workflow !== undefined && !isWorkflowConfiguration(value.workflow)) {
    throw new ConfigurationError("Specta configuration at " + manifestPath + " contains invalid workflow configuration.")
  }
  const workflow = value.workflow === undefined ? defaultWorkflowConfiguration() : value.workflow
  return { ...value, workflow } as unknown as Workspace
}

function isProject(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string" &&
    typeof value.rootPath === "string" && typeof value.manifestPath === "string" &&
    ["application", "library", "package", "service", "unknown"].includes(String(value.kind))
}

function isWorkflowConfiguration(value: unknown): value is WorkflowConfiguration {
  return isRecord(value) && value.templateSetVersion === 1 && Array.isArray(value.integrations) &&
    value.integrations.every((integration) => typeof integration === "string" && integration.length > 0) &&
    new Set(value.integrations).size === value.integrations.length &&
    Array.isArray(value.templates) && value.templates.length === workflowTemplateIds.length &&
    value.templates.every(isDefaultWorkflowTemplate) &&
    new Set(value.templates.map((template) => isRecord(template) ? template.id : "")).size === workflowTemplateIds.length
}

function isDefaultWorkflowTemplate(value: unknown): boolean {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.path !== "string" || value.version !== 1) {
    return false
  }
  const id = value.id as WorkflowTemplateId
  return workflowTemplateIds.includes(id) && value.path === ".specta/workflows/" + id + ".md"
}
