export type WorkspaceId = string & { readonly __brand: "WorkspaceId" }
export type ProjectId = string & { readonly __brand: "ProjectId" }
export type PlanningId = string & { readonly __brand: "PlanningId" }

export type ProjectKind = "application" | "library" | "package" | "service" | "unknown"
export type PackageManager = "npm" | "pnpm" | "yarn" | "unknown"
export type SkillTarget = string
export type WorkflowTemplateId = "plan" | "design" | "scaffold" | "implement" | "review" | "validate" | "context"

export interface WorkflowParameter {
  name: string
  description: string
  required: boolean
}

export interface WorkflowDefinition {
  name: string
  description: string
  parameters: WorkflowParameter[]
  requires: string[]
  produces: string[]
  executionSteps: string[]
  promptTemplate: string
  artifactTemplates: string[]
  completionCriteria: string[]
  validationRequirements: string[]
}

export interface WorkflowManifest {
  version: 1
  workflows: WorkflowDefinition[]
}

export interface WorkflowConfiguration {
  skillTargets: SkillTarget[]
  manifestPath: string
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
  visionPath?: string
  constitutionPath?: string
  architecturePath?: string
  roadmapPath?: string
  planningPath?: string
  globalRulesPath?: string
}

export interface Vision {
  id: PlanningId
  title: string
  problem: string
  audience: string
  outcome: string
}

export interface Constitution {
  id: PlanningId
  principles: string[]
}

export interface Architecture {
  id: PlanningId
  overview: string
  components: string[]
}

export interface Roadmap {
  id: PlanningId
  milestones: string[]
}

export interface Task {
  id: PlanningId
  title: string
  description: string
}

export interface Story {
  id: PlanningId
  title: string
  description: string
  acceptanceCriteria: string[]
  tasks: Task[]
}

export interface Epic {
  id: PlanningId
  title: string
  goal: string
  stories: Story[]
}

export type PlanningRelationshipType = "CONTAINS" | "DEPENDS_ON" | "IMPLEMENTS"

export interface PlanningRelationship {
  type: PlanningRelationshipType
  sourceId: PlanningId
  targetId: PlanningId
}

export interface ProjectPlan {
  vision: Vision
  constitution: Constitution
  architecture: Architecture
  roadmap: Roadmap
  epics: Epic[]
  relationships: PlanningRelationship[]
}

export type PlanningStage = "foundation" | "architecture" | "roadmap" | "epics"

export interface PlanningState {
  brief: string
  completedStages: PlanningStage[]
  vision?: Vision
  constitution?: Constitution
  architecture?: Architecture
  roadmap?: Roadmap
  epics?: Epic[]
  relationships: PlanningRelationship[]
}

export interface PlanningArtifact {
  kind: "vision" | "constitution" | "architecture" | "roadmap" | "epic"
  path: string
}

export interface PlanningArtifactSet {
  rootPath: string
  documents: PlanningArtifact[]
}

export type TechnicalDesignStatus = "draft" | "needs-changes" | "approved"
export type TechnicalFileKind = "source" | "test" | "configuration"
export type TechnicalSymbolKind = "class" | "interface" | "function" | "type" | "constant"
export type TechnicalDependencyStatus = "available" | "planned" | "blocked"

export interface TechnicalSymbol {
  name: string
  kind: TechnicalSymbolKind
  signature?: string
  purpose: string
}

export interface TechnicalFile {
  path: string
  kind: TechnicalFileKind
  exports: TechnicalSymbol[]
}

export interface TechnicalModule {
  name: string
  path: string
  purpose: string
  files: TechnicalFile[]
  dependencies: PlanningId[]
}

export interface TechnicalDependency {
  targetId: PlanningId
  kind: "file" | "symbol" | "technical-design"
  status: TechnicalDependencyStatus
}

export interface ImpactRequest {
  targetId: PlanningId
  description: string
}

export interface TechnicalDesign {
  id: PlanningId
  targetId: PlanningId
  status: TechnicalDesignStatus
  revision: number
  summary: string
  modules: TechnicalModule[]
  dependencies: TechnicalDependency[]
  impactRequests: ImpactRequest[]
  feedback?: string
  scaffoldedPaths?: string[]
}

export interface ScaffoldResult {
  designId: PlanningId
  createdPaths: string[]
  preservedPaths: string[]
  workspace: Workspace
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
