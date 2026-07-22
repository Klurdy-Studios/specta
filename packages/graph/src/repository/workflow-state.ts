import {
  epicImplementationStateSchema,
  planningStateSchema,
  workflowRunSchema,
  type EpicImplementationState,
  type PlanningState,
  type WorkflowRun,
  type Workspace,
} from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { validationReportSchema, type ValidationReport } from "@specta/core/validation"
import { nodeFileSystem } from "@specta/core/filesystem"
import { z } from "zod"
import { createStableGraphId } from "../analysis/identifiers.ts"
import { createSqliteWorkspaceGraphProvider } from "../persistence/sqlite.ts"
import { createGraphEdge } from "../updates/apply-projection.ts"
import { validationReportProjection } from "../validation.ts"
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
  validationReport?: ValidationReport
  implementationLinks?: ImplementationLink[]
}

/** A deterministic planned-to-implemented relationship committed at successful finalization. */
export type ImplementationLink =
  | {
    kind: "IMPLEMENTS"
    sourceId: string
    sourceKind: "File" | "CodeSymbol"
    targetId: string
    targetKind: "Epic" | "TechnicalDesign"
  }
  | {
    kind: "VALIDATES"
    sourceId: string
    sourceKind: "Test"
    targetId: string
    targetKind: "AcceptanceCriterion"
  }

/** Durable access to Workflow Runs and mutable Epic implementation state. */
export interface WorkflowStateRepository {
  getRun(workspace: Workspace, runId: string): Promise<WorkflowRun | null>
  getEpicState(workspace: Workspace, epicId: string): Promise<EpicImplementationState | null>
  saveImplementationCheckpoint(workspace: Workspace, checkpoint: ImplementationCheckpoint): Promise<void>
}

const activeImplementationSchema = z.object({
  runId: z.string().min(1),
  epicId: z.string().min(1),
}).strict()
const activeImplementationDocumentKey = "active-implementation-run"

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
      const report = checkpoint.validationReport === undefined
        ? undefined
        : validationReportSchema.parse(checkpoint.validationReport)
      const links = checkpoint.implementationLinks ?? []
      if (run.workflow !== "implement") {
        throw new Error("Implementation checkpoints require an implement Workflow Run.")
      }
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
      if (report) {
        if (report.implementationRunId !== checkpoint.runId || report.epicId !== state.epicId) {
          throw new Error("Validation Report must target the checkpoint Implementation Run and Epic.")
        }
        const expectedValidationState = report.status === "passed" ? "complete" : "validation-failed"
        if (run.status !== expectedValidationState || state.status !== expectedValidationState) {
          throw new Error("Validation Report status is inconsistent with the implementation checkpoint.")
        }
      } else if (run.workflow === "implement" && (run.status === "complete" || run.status === "validation-failed")) {
        throw new Error("Implementation completion and validation failure checkpoints require a Validation Report.")
      }
      if (links.length > 0 && run.status !== "complete") {
        throw new Error("Implementation relationships require a completed Implementation Run.")
      }
      const stateId = implementationStateId(state.epicId)
      const runNode: GraphNodeUpsert = { id: checkpoint.runId, kind: "WorkflowRun", props: run }
      const runEdges: GraphEdgeUpsert[] = [
        relationship("TARGETS", checkpoint.runId, state.epicId, "WorkflowRun", "Epic"),
        ...[...new Set([...(checkpoint.producedNodeIds ?? []), ...(report ? [report.id] : [])])].map((targetId) =>
          relationship("PRODUCES", checkpoint.runId, targetId, "WorkflowRun"),
        ),
        ...links.map((link) => relationship(
          link.kind,
          link.sourceId,
          link.targetId,
          link.sourceKind,
          link.targetKind,
        )),
      ]
      const reportProjection = report ? validationReportProjection(report) : undefined
      await provider.withGraph(workspace, (graph) => graph.transaction(async (transaction) => {
        const currentRunValue = await transaction.readDocument<unknown>("workflow-run:" + checkpoint.runId)
        const currentStateValue = await transaction.readDocument<unknown>("epic-implementation-state:" + state.epicId)
        const activeValue = await transaction.readDocument<unknown>(activeImplementationDocumentKey)
        const active = activeValue === null ? null : activeImplementationSchema.parse(activeValue)
        if (run.status === "complete") {
          if (active && active.runId !== checkpoint.runId) {
            throw new Error("A different Implementation Run is active: " + active.runId + ".")
          }
        } else if (active && active.epicId !== state.epicId) {
          throw new Error("Another Epic already has an active Implementation Run: " + active.epicId + ".")
        }
        if (report?.status === "passed") {
          const planningValue = await transaction.readDocument<unknown>("planning-state")
          if (planningValue === null) throw new Error("Implementation completion requires planning state.")
          requireCompleteValidationCoverage(report, planningStateSchema.parse(planningValue))
        }
        requireNextRevision(currentRunValue, run, workflowRunSchema, "Workflow Run")
        requireNextRevision(currentStateValue, state, epicImplementationStateSchema, "Epic implementation state")
        await transaction.projections.applyMany([
          ...(reportProjection ? [{
            ...reportProjection,
            // The run projection below owns this edge during an atomic checkpoint.
            // Omitting the duplicate lets the report node exist before the edge is materialized.
            edges: reportProjection.edges.filter((edge) => edge.kind !== "PRODUCES"),
          }] : []),
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
          {
            key: activeImplementationDocumentKey,
            nodes: [],
            edges: [],
            documents: [{
              key: activeImplementationDocumentKey,
              value: run.status === "complete" ? null : { runId: checkpoint.runId, epicId: state.epicId },
            }],
          },
        ])
      }))
    },
  }
}

function requireCompleteValidationCoverage(report: ValidationReport, planning: PlanningState): void {
  const epic = planning.epics?.find((candidate) => candidate.id === report.epicId)
  if (!epic || !planning.architecture) throw new Error("Validation Report targets incomplete planning state.")
  const passed = (category: ValidationReport["checks"][number]["category"], subjectId: string) =>
    report.checks.find((check) =>
      check.category === category && check.subject.id === subjectId && check.status === "passed",
    )
  if (!passed("requirement", epic.id)) throw new Error("Validation Report is missing passing Epic coverage.")
  for (const story of epic.stories) {
    if (!passed("requirement", story.id)) throw new Error("Validation Report is missing passing Story coverage: " + story.id + ".")
    for (const criterion of story.acceptanceCriteria) {
      const criterionCheck = passed("acceptance-criterion", criterion.id)
      if (!criterionCheck || criterionCheck.evidenceNodeIds.length === 0) {
        throw new Error("Validation Report is missing verified acceptance-criterion coverage: " + criterion.id + ".")
      }
      const verifiedTests = report.checks.filter((check) =>
        check.category === "test"
        && check.status === "passed"
        && check.subject.id !== undefined
        && criterionCheck.evidenceNodeIds.includes(check.subject.id),
      )
      if (verifiedTests.length !== criterionCheck.evidenceNodeIds.length) {
        throw new Error("Validation Report acceptance evidence is not fully verified: " + criterion.id + ".")
      }
    }
  }
  const architectureComponentChecks = report.checks.filter((check) =>
    check.category === "architecture"
    && check.subject.kind === "architecture-component"
    && check.subject.id === planning.architecture?.id,
  )
  for (const check of architectureComponentChecks) {
    if (check.status !== "passed") {
      throw new Error("Validation Report is missing architecture coverage: " + check.subject.name + ".")
    }
  }
  if (!report.checks.some((check) =>
    check.category === "architecture"
    && check.subject.kind === "technical-design"
    && check.subject.id !== undefined
    && check.status === "passed"
  )) throw new Error("Validation Report is missing approved Technical Design coverage.")
  if (!report.checks.some((check) => check.category === "file" && check.status === "passed")) {
    throw new Error("Validation Report is missing implemented file coverage.")
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
