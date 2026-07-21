import {
  epicImplementationStateSchema,
  workflowRunSchema,
  type EpicImplementationState,
  type WorkflowRun,
  type Workspace,
} from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { nodeFileSystem } from "@specta/core/filesystem"
import { createStableGraphId } from "../analysis/identifiers.ts"
import { createSqliteWorkspaceGraphProvider } from "../persistence/sqlite.ts"
import { createGraphEdge } from "../updates/apply-projection.ts"
import type {
  GraphEdgeUpsert,
  GraphNodeUpsert,
  WorkspaceGraphNodeKind,
  WorkspaceGraphProvider,
} from "./contracts.ts"

/** Atomic implementation-run checkpoint and the Epic state it establishes. */
export interface ImplementationCheckpoint {
  runId: string
  run: WorkflowRun
  state: EpicImplementationState
  producedNodeIds?: string[]
}

/** Durable access to Workflow Runs and mutable Epic implementation state. */
export interface WorkflowStateRepository {
  getRun(workspace: Workspace, runId: string): Promise<WorkflowRun | null>
  getEpicState(workspace: Workspace, epicId: string): Promise<EpicImplementationState | null>
  saveImplementationCheckpoint(workspace: Workspace, checkpoint: ImplementationCheckpoint): Promise<void>
}

/** Persists workflow execution and Epic delivery state in one graph transaction. */
export function createWorkflowStateRepository(
  fileSystem: FileSystem = nodeFileSystem,
  provider: WorkspaceGraphProvider = createSqliteWorkspaceGraphProvider({ fileSystem }),
): WorkflowStateRepository {
  return {
    getRun: (workspace, runId) => provider.withGraph(workspace, async (graph) => {
      const value = await graph.readDocument<unknown>("workflow-run:" + runId)
      return value === null ? null : workflowRunSchema.parse(value)
    }),
    getEpicState: (workspace, epicId) => provider.withGraph(workspace, async (graph) => {
      const value = await graph.readDocument<unknown>("epic-implementation-state:" + epicId)
      return value === null ? null : epicImplementationStateSchema.parse(value)
    }),
    async saveImplementationCheckpoint(workspace, checkpoint) {
      if (!checkpoint.runId.trim()) throw new Error("Implementation workflow run ID is required.")
      const run = workflowRunSchema.parse(checkpoint.run)
      const state = epicImplementationStateSchema.parse(checkpoint.state)
      if (run.targetKind !== "epic" || run.targetId !== state.epicId) {
        throw new Error("Implementation workflow run must target its Epic implementation state.")
      }
      if (state.activeRunId !== undefined && state.activeRunId !== checkpoint.runId) {
        throw new Error("Epic implementation state must reference the checkpoint run as its active run.")
      }
      const expectedState = run.status === "prepared" ? "ready" : run.status
      if (state.status !== expectedState) {
        throw new Error("Workflow run and Epic implementation statuses are inconsistent.")
      }
      const stateId = implementationStateId(state.epicId)
      const runNode: GraphNodeUpsert = { id: checkpoint.runId, kind: "WorkflowRun", props: run }
      const runEdges: GraphEdgeUpsert[] = [
        relationship("TARGETS", checkpoint.runId, state.epicId, "WorkflowRun", "Epic"),
        ...[...new Set(checkpoint.producedNodeIds ?? [])].map((targetId) =>
          relationship("PRODUCES", checkpoint.runId, targetId, "WorkflowRun"),
        ),
      ]
      await provider.withGraph(workspace, (graph) => graph.transaction(async (transaction) => {
        const currentRunValue = await transaction.readDocument<unknown>("workflow-run:" + checkpoint.runId)
        const currentStateValue = await transaction.readDocument<unknown>("epic-implementation-state:" + state.epicId)
        requireNextRevision(currentRunValue, run, workflowRunSchema, "Workflow Run")
        requireNextRevision(currentStateValue, state, epicImplementationStateSchema, "Epic implementation state")
        await transaction.projections.applyMany([
          {
            key: "workflow-run:" + checkpoint.runId,
            nodes: [runNode],
            edges: runEdges,
            documents: [{ key: "workflow-run:" + checkpoint.runId, value: run }],
          },
          {
            key: "epic-implementation-state:" + state.epicId,
            nodes: [{ id: stateId, kind: "EpicImplementationState", props: state }],
            edges: [relationship("HAS_STATE", state.epicId, stateId, "Epic", "EpicImplementationState")],
            documents: [{ key: "epic-implementation-state:" + state.epicId, value: state }],
          },
        ])
      }))
    },
  }
}

function requireNextRevision<T extends { revision: number }>(
  currentValue: unknown,
  next: T,
  schema: { parse(value: unknown): T },
  label: string,
): void {
  if (currentValue === null) return
  const current = schema.parse(currentValue)
  if (next.revision < current.revision) throw new Error(label + " revision cannot move backwards.")
  if (next.revision === current.revision && JSON.stringify(next) !== JSON.stringify(current)) {
    throw new Error(label + " changes require a new revision.")
  }
}

function implementationStateId(epicId: string): string {
  return createStableGraphId("epic-implementation-state", ".", epicId)
}

function relationship(
  kind: GraphEdgeUpsert["kind"],
  sourceId: string,
  targetId: string,
  sourceKind?: WorkspaceGraphNodeKind,
  targetKind?: WorkspaceGraphNodeKind,
): GraphEdgeUpsert {
  return createGraphEdge({
    kind,
    sourceId,
    targetId,
    ...(sourceKind ? { sourceKind } : {}),
    ...(targetKind ? { targetKind } : {}),
  })
}
