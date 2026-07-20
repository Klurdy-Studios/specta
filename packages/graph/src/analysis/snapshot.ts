import { z } from "zod"
import { workspaceAnalysisSchema } from "@specta/core"

export const analysisGraphNodeTypeSchema = z.enum([
  "SPECIFICATION_DOCUMENT",
  "REQUIREMENT",
  "ARCHITECTURE_DECISION",
  "EPIC",
  "STORY",
  "ACCEPTANCE_CRITERION",
  "TASK",
  "FILE",
  "CODE_SYMBOL",
  "TEST",
  "EXTERNAL_DEPENDENCY",
])
export const analysisGraphNodeSchema = z.object({
  id: z.string().min(1),
  type: analysisGraphNodeTypeSchema,
  path: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  signature: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
}).strict()
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
  schemaVersion: z.literal(1),
  analysis: workspaceAnalysisSchema,
  nodes: z.array(analysisGraphNodeSchema),
  relationships: z.array(analysisGraphRelationshipSchema),
}).strict()
export type AnalysisGraphSnapshot = z.infer<typeof analysisGraphSnapshotSchema>

