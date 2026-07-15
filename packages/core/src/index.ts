export type WorkspaceId = string & { readonly __brand: "WorkspaceId" }
export type ProjectId = string & { readonly __brand: "ProjectId" }

export type ProjectKind = "application" | "library" | "package" | "service" | "unknown"
export type PackageManager = "npm" | "pnpm" | "yarn" | "unknown"
export type AgentIntegration = string
export type WorkflowTemplateId = "plan" | "design" | "scaffold" | "implement" | "review" | "validate" | "context"

export interface WorkflowTemplate {
  id: WorkflowTemplateId
  path: string
  version: 1
}

export interface WorkflowConfiguration {
  integrations: AgentIntegration[]
  templateSetVersion: 1
  templates: WorkflowTemplate[]
}

export const workflowTemplateIds: readonly WorkflowTemplateId[] = [
  "plan",
  "design",
  "scaffold",
  "implement",
  "review",
  "validate",
  "context",
]

export interface Project {
  id: ProjectId
  name: string
  rootPath: string
  kind: ProjectKind
  manifestPath: string
}

export interface WorkspaceArtifacts {
  constitutionPath?: string
  architecturePath?: string
  globalRulesPath?: string
}

export interface Workspace {
  schemaVersion: 1
  id: WorkspaceId
  rootPath: string
  createdAt: string
  packageManager: PackageManager
  projects: Project[]
  artifacts: WorkspaceArtifacts
  workflow: WorkflowConfiguration
}

export class SpectaError extends Error {
  public readonly code: string
  public override readonly cause?: unknown

  public constructor(message: string, code: string, cause?: unknown) {
    super(message)
    this.name = "SpectaError"
    this.code = code
    this.cause = cause
  }
}

export class ConfigurationError extends SpectaError {
  public constructor(message: string, cause?: unknown) {
    super(message, "CONFIGURATION_ERROR", cause)
    this.name = "ConfigurationError"
  }
}

export class DiscoveryError extends SpectaError {
  public constructor(message: string, cause?: unknown) {
    super(message, "DISCOVERY_ERROR", cause)
    this.name = "DiscoveryError"
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
