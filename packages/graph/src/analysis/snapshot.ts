import { z } from "zod"
import { projectIdSchema, specificationEntityKindSchema, technicalSymbolKindSchema, workspaceAnalysisSchema } from "@specta/core"

export const specificationDocumentPropertiesSchema = z.object({
  path: z.string().min(1),
  title: z.string().min(1).optional(),
}).strict()
export const specificationEntityPropertiesSchema = z.object({
  title: z.string().min(1),
  path: z.string().min(1),
  entityKind: specificationEntityKindSchema,
}).strict()
export const filePropertiesSchema = z.object({
  path: z.string().min(1),
  fileKind: z.enum(["source", "test", "configuration", "asset"]),
  projectId: projectIdSchema.optional(),
}).strict()
export const codeSymbolPropertiesSchema = z.object({
  name: z.string().min(1),
  symbolKind: technicalSymbolKindSchema,
  signature: z.string().min(1).optional(),
  purpose: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
}).strict()
export const testPropertiesSchema = z.object({
  name: z.string().min(1),
  framework: z.enum(["vitest", "jest", "node", "unknown"]),
  path: z.string().min(1),
}).strict()
export const externalDependencyPropertiesSchema = z.object({ name: z.string().min(1) }).strict()

const identified = z.object({ id: z.string().min(1) })
export const analysisGraphNodeSchema = z.discriminatedUnion("type", [
  identified.extend({ type: z.literal("SPECIFICATION_DOCUMENT"), ...specificationDocumentPropertiesSchema.shape }).strict(),
  identified.extend({ type: z.literal("SPECIFICATION_ENTITY"), ...specificationEntityPropertiesSchema.shape }).strict(),
  identified.extend({ type: z.literal("FILE"), ...filePropertiesSchema.shape }).strict(),
  identified.extend({ type: z.literal("CODE_SYMBOL"), ...codeSymbolPropertiesSchema.shape }).strict(),
  identified.extend({ type: z.literal("TEST"), ...testPropertiesSchema.shape }).strict(),
  identified.extend({ type: z.literal("EXTERNAL_DEPENDENCY"), ...externalDependencyPropertiesSchema.shape }).strict(),
])
export type AnalysisGraphNode = z.infer<typeof analysisGraphNodeSchema>

export const analysisGraphRelationshipSchema = z.object({
  type: z.enum(["CONTAINS", "IMPORTS", "EXPORTS", "TESTS", "REFERENCES"]),
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
}).strict().refine((relationship) => relationship.sourceId !== relationship.targetId, {
  message: "Analysis relationships cannot be self-referential.",
})
export type AnalysisGraphRelationship = z.infer<typeof analysisGraphRelationshipSchema>

/** Persisted full-rebuild result of specification and source analysis. */
export const analysisGraphSnapshotSchema = z.object({
  schemaVersion: z.literal(2),
  analysis: workspaceAnalysisSchema,
  nodes: z.array(analysisGraphNodeSchema),
  relationships: z.array(analysisGraphRelationshipSchema),
}).strict().superRefine((snapshot, context) => {
  const nodeIds = new Set(snapshot.nodes.map((node) => node.id))
  if (nodeIds.size !== snapshot.nodes.length) {
    context.addIssue({ code: "custom", message: "Analysis graph node IDs must be unique.", path: ["nodes"] })
  }
  for (const [index, relationship] of snapshot.relationships.entries()) {
    if (!nodeIds.has(relationship.sourceId)) {
      context.addIssue({ code: "custom", message: "Relationship source must reference an analysis node.", path: ["relationships", index, "sourceId"] })
    }
    if (relationship.type !== "REFERENCES" && !nodeIds.has(relationship.targetId)) {
      context.addIssue({ code: "custom", message: "Relationship target must reference an analysis node.", path: ["relationships", index, "targetId"] })
    }
  }
})
export type AnalysisGraphSnapshot = z.infer<typeof analysisGraphSnapshotSchema>
