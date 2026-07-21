import { z } from "zod"

const nonEmptyText = z.string().trim().min(1)

export const contextRequestSchema = z.object({
  epicId: nonEmptyText,
  implementationRunId: nonEmptyText.optional(),
  workflow: z.literal("implement"),
  maxTokens: z.number().int().positive().optional(),
}).strict()

export type ContextRequest = z.infer<typeof contextRequestSchema>

const contextAcceptanceCriterionSchema = z.object({ id: nonEmptyText, description: nonEmptyText }).strict()
const contextTaskSchema = z.object({ id: nonEmptyText, title: nonEmptyText, description: nonEmptyText }).strict()
const contextStorySchema = z.object({
  id: nonEmptyText,
  title: nonEmptyText,
  description: nonEmptyText,
  acceptanceCriteria: z.array(contextAcceptanceCriterionSchema),
  tasks: z.array(contextTaskSchema),
}).strict()

const contextDesignSymbolSchema = z.object({
  name: nonEmptyText,
  kind: nonEmptyText,
  purpose: nonEmptyText,
  signature: nonEmptyText.optional(),
}).strict()
const contextDesignFileSchema = z.object({
  path: nonEmptyText,
  kind: nonEmptyText,
  ownership: nonEmptyText,
  exports: z.array(contextDesignSymbolSchema),
}).strict()
const contextDesignModuleSchema = z.object({
  name: nonEmptyText,
  path: nonEmptyText,
  purpose: nonEmptyText,
  files: z.array(contextDesignFileSchema),
}).strict()

const contextDependencySchema = z.object({
  nodeId: nonEmptyText.optional(),
  kind: z.enum(["epic", "technical-design", "file", "symbol", "external"]),
  label: nonEmptyText,
  path: nonEmptyText.optional(),
  status: nonEmptyText.optional(),
  reason: nonEmptyText.optional(),
  required: z.boolean(),
}).strict()

const contextSourceFileSchema = z.object({
  nodeId: nonEmptyText,
  path: nonEmptyText,
  fileKind: z.enum(["source", "test", "configuration", "asset"]),
  relevance: z.enum(["designed", "dependency", "test"]),
  score: z.number().int().nonnegative(),
}).strict()

const contextSymbolSchema = z.object({
  nodeId: nonEmptyText,
  path: nonEmptyText.optional(),
  name: nonEmptyText,
  symbolKind: nonEmptyText,
  signature: nonEmptyText.optional(),
  purpose: nonEmptyText.optional(),
  score: z.number().int().nonnegative(),
}).strict()

const contextTestSchema = z.object({
  nodeId: nonEmptyText,
  path: nonEmptyText,
  name: nonEmptyText,
  framework: nonEmptyText,
  score: z.number().int().nonnegative(),
}).strict()

const contextImpactSchema = z.object({
  nodeId: nonEmptyText,
  kind: z.enum(["file", "symbol", "test", "epic"]),
  path: nonEmptyText.optional(),
  name: nonEmptyText.optional(),
  depth: z.number().int().positive(),
  reason: z.enum(["imports", "references", "tests", "depends-on"]),
}).strict()

export const contextPacketSchema = z.object({
  schemaVersion: z.literal(1),
  key: nonEmptyText,
  workflow: z.literal("implement"),
  epicId: nonEmptyText,
  implementationRunId: nonEmptyText.optional(),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  epic: z.object({ id: nonEmptyText, title: nonEmptyText, goal: nonEmptyText }).strict(),
  stories: z.array(contextStorySchema),
  architecture: z.object({
    overview: nonEmptyText,
    components: z.array(nonEmptyText),
    guidance: nonEmptyText.optional(),
    principles: z.array(nonEmptyText),
  }).strict(),
  technicalDesign: z.object({
    id: nonEmptyText,
    revision: z.number().int().positive(),
    status: z.enum(["approved", "scaffolded"]),
    summary: nonEmptyText,
    targetRootPath: z.string(),
    modules: z.array(contextDesignModuleSchema),
  }).strict(),
  dependencies: z.array(contextDependencySchema),
  sourceFiles: z.array(contextSourceFileSchema),
  symbols: z.array(contextSymbolSchema),
  tests: z.array(contextTestSchema),
  blastRadius: z.object({
    directConsumers: z.array(contextImpactSchema),
    transitiveConsumers: z.array(contextImpactSchema),
    affectedTests: z.array(contextImpactSchema),
    dependentEpics: z.array(contextImpactSchema),
    totals: z.object({
      directConsumers: z.number().int().nonnegative(),
      transitiveConsumers: z.number().int().nonnegative(),
      affectedTests: z.number().int().nonnegative(),
      dependentEpics: z.number().int().nonnegative(),
    }).strict(),
    truncated: z.boolean(),
  }).strict(),
  relevantNodeIds: z.array(nonEmptyText),
  tokenUsage: z.object({
    budget: z.number().int().positive(),
    estimated: z.number().int().nonnegative(),
    candidateEstimate: z.number().int().nonnegative(),
    reductionPercentage: z.number().min(0).max(100),
    overBudget: z.boolean(),
  }).strict(),
  diagnostics: z.array(z.object({
    code: nonEmptyText,
    message: nonEmptyText,
  }).strict()),
}).strict()

export type ContextPacket = z.infer<typeof contextPacketSchema>
export type ContextDependency = ContextPacket["dependencies"][number]
export type ContextSourceFile = ContextPacket["sourceFiles"][number]
export type ContextSymbol = ContextPacket["symbols"][number]
export type ContextTest = ContextPacket["tests"][number]
export type ContextImpact = ContextPacket["blastRadius"]["directConsumers"][number]

/** Compiles the smallest sufficient implementation context from the Workspace Graph. */
export interface ContextEngine {
  compile(workspace: import("@specta/core").Workspace, request: ContextRequest): Promise<ContextPacket>
}

/** Durable run-keyed access to compiled implementation packets. */
export interface ContextPacketRepository {
  get(workspace: import("@specta/core").Workspace, implementationRunId: string): Promise<ContextPacket | null>
  /** Persists a packet or returns the immutable packet that won a concurrent prepare. */
  save(workspace: import("@specta/core").Workspace, packet: ContextPacket): Promise<ContextPacket>
}

export const DEFAULT_CONTEXT_TOKEN_BUDGET = 8_000
