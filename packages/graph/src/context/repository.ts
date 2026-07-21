import type { Workspace } from "@specta/core"
import { workflowRunSchema } from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { nodeFileSystem } from "@specta/core/filesystem"
import { createStableGraphId } from "../analysis/identifiers.ts"
import { createSqliteWorkspaceGraphProvider } from "../persistence/sqlite.ts"
import type { GraphEdgeUpsert, WorkspaceGraphNodeKind, WorkspaceGraphProvider } from "../repository/contracts.ts"
import { createGraphEdge } from "../updates/apply-projection.ts"
import { contextPacketSchema, type ContextPacket, type ContextPacketRepository } from "./contracts.ts"

function documentKey(runId: string): string {
  return "context-packet:" + runId
}

/** Creates graph-backed, run-keyed Context Packet persistence. */
export function createContextPacketRepository(
  fileSystem: FileSystem = nodeFileSystem,
  provider: WorkspaceGraphProvider = createSqliteWorkspaceGraphProvider({ fileSystem }),
): ContextPacketRepository {
  return {
    get: (workspace, implementationRunId) => provider.withGraph(workspace, async (graph) => {
      const value = await graph.readDocument<unknown>(documentKey(implementationRunId))
      if (value === null) return null
      const packet = contextPacketSchema.parse(value)
      const runValue = await graph.readDocument<unknown>("workflow-run:" + implementationRunId)
      if (runValue === null) throw new Error("Context packet references a missing Implementation Run: " + implementationRunId + ".")
      const run = workflowRunSchema.parse(runValue)
      if (run.workflow !== "implement" || run.targetKind !== "epic" || run.targetId !== packet.epicId) {
        throw new Error("Context packet and Implementation Run must target the same Epic.")
      }
      return packet
    }),
    async save(workspace: Workspace, value: ContextPacket) {
      const packet = contextPacketSchema.parse(value)
      const runId = packet.implementationRunId
      if (!runId) throw new Error("Persisted context requires an Implementation Run ID.")
      return provider.withGraph(workspace, async (graph) => {
        const runValue = await graph.readDocument<unknown>("workflow-run:" + runId)
        if (runValue === null) throw new Error("Implementation Run not found: " + runId + ".")
        const run = workflowRunSchema.parse(runValue)
        if (run.workflow !== "implement" || run.targetKind !== "epic" || run.targetId !== packet.epicId) {
          throw new Error("Context packet and Implementation Run must target the same Epic.")
        }
        const resolvedNodes = await Promise.all(packet.relevantNodeIds.map((id) => graph.queries.getNode(id)))
        const missingNodeIds = packet.relevantNodeIds.filter((_, index) => resolvedNodes[index] === null)
        if (missingNodeIds.length > 0) {
          throw new Error("Context packet references missing graph nodes: " + missingNodeIds.join(", ") + ".")
        }
        const includedNodes = resolvedNodes.filter((node): node is NonNullable<typeof node> => node !== null)
        const packetId = createStableGraphId("context-packet", ".", runId)
        const includes = includedNodes.map((node): GraphEdgeUpsert => relationship(
          "INCLUDES", packetId, node.id, "ContextPacket", node.kind,
        ))
        return graph.transaction(async (transaction) => {
          const current = await transaction.readDocument<unknown>(documentKey(runId))
          if (current !== null) {
            const existing = contextPacketSchema.parse(current)
            return existing
          }
          await transaction.projections.apply({
            key: documentKey(runId),
            nodes: [{
              id: packetId,
              kind: "ContextPacket",
              props: {
                epicId: packet.epicId,
                implementationRunId: runId,
                sourceFingerprint: packet.sourceFingerprint,
                estimatedTokens: packet.tokenUsage.estimated,
                maxTokens: packet.tokenUsage.budget,
                overBudget: packet.tokenUsage.overBudget,
              },
            }],
            edges: [
              relationship("PRODUCES", runId, packetId, "WorkflowRun", "ContextPacket"),
              ...includes,
            ],
            documents: [{ key: documentKey(runId), value: packet }],
          })
          return packet
        })
      })
    },
  }
}

function relationship(
  kind: GraphEdgeUpsert["kind"],
  sourceId: string,
  targetId: string,
  sourceKind: WorkspaceGraphNodeKind,
  targetKind: WorkspaceGraphNodeKind,
): GraphEdgeUpsert {
  return createGraphEdge({ kind, sourceId, targetId, sourceKind, targetKind })
}
