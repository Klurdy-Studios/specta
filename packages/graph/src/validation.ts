import { workflowRunSchema, type Workspace } from "@specta/core"
import { validationReportSchema, type ValidationReport } from "@specta/core/validation"
import type { FileSystem } from "@specta/core/filesystem"
import { nodeFileSystem } from "@specta/core/filesystem"
import { createSqliteWorkspaceGraphProvider } from "./persistence/sqlite.ts"
import type { GraphEdgeUpsert, GraphProjection, WorkspaceGraphProvider } from "./repository/contracts.ts"
import { createGraphEdge } from "./updates/apply-projection.ts"

/** Durable access to exact Validation Reports and their graph provenance. */
export interface ValidationReportRepository {
  get(workspace: Workspace, reportId: string): Promise<ValidationReport | null>
  save(workspace: Workspace, report: ValidationReport): Promise<void>
}

/** Creates graph-backed Validation Report persistence. */
export function createValidationReportRepository(
  fileSystem: FileSystem = nodeFileSystem,
  provider: WorkspaceGraphProvider = createSqliteWorkspaceGraphProvider({ fileSystem }),
): ValidationReportRepository {
  return {
    get: (workspace, reportId) => provider.withGraph(workspace, async (graph) => {
      const value = await graph.readDocument<unknown>(validationDocumentKey(reportId))
      return value === null ? null : validationReportSchema.parse(value)
    }),
    async save(workspace, value) {
      const report = validationReportSchema.parse(value)
      await provider.withGraph(workspace, async (graph) => {
        if (report.implementationRunId) {
          const runValue = await graph.readDocument<unknown>("workflow-run:" + report.implementationRunId)
          if (runValue === null) throw new Error("Validation Report references a missing Implementation Run.")
          const run = workflowRunSchema.parse(runValue)
          if (run.workflow !== "implement" || run.targetId !== report.epicId || run.targetKind !== "epic") {
            throw new Error("Validation Report and Implementation Run must target the same Epic.")
          }
        }
        await graph.projections.apply(validationReportProjection(report))
      })
    },
  }
}

/** Converts one exact report into its compact graph projection. */
export function validationReportProjection(reportValue: ValidationReport): GraphProjection {
  const report = validationReportSchema.parse(reportValue)
  const targetIds = new Set([
    report.epicId,
    ...report.checks.flatMap((check) => [check.subject.id, ...check.evidenceNodeIds])
      .filter((id): id is string => id !== undefined),
  ])
  const edges: GraphEdgeUpsert[] = [...targetIds].map((targetId) => createGraphEdge({
    kind: "VALIDATES",
    sourceId: report.id,
    targetId,
    sourceKind: "ValidationReport",
  }))
  if (report.implementationRunId) edges.push(createGraphEdge({
    kind: "PRODUCES",
    sourceId: report.implementationRunId,
    targetId: report.id,
    sourceKind: "WorkflowRun",
    targetKind: "ValidationReport",
  }))
  return {
    key: validationDocumentKey(report.id),
    nodes: [{
      id: report.id,
      kind: "ValidationReport",
      props: {
        epicId: report.epicId,
        ...(report.implementationRunId ? { implementationRunId: report.implementationRunId } : {}),
        mode: report.mode,
        contextFingerprint: report.contextFingerprint,
        sourceFingerprint: report.sourceFingerprint,
        status: report.status,
        summary: report.summary,
      },
    }],
    edges,
    documents: [{ key: validationDocumentKey(report.id), value: report }],
  }
}

function validationDocumentKey(reportId: string): string {
  return "validation-report:" + reportId
}
