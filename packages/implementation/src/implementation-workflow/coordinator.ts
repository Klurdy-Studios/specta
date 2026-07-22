import { createHash } from "node:crypto"
import {
  codingAgentTokenUsageSchema,
  type EpicImplementationState,
  type PlanningId,
  type WorkflowRun,
} from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { nodeFileSystem } from "@specta/core/filesystem"
import type { ValidationReport } from "@specta/core/validation"
import {
  createContextEngine,
  createContextPacketRepository,
  createImplementationEligibilityResolver,
  createValidationReportRepository,
  createWorkflowStateRepository,
  createWorkspaceAnalyzer,
  type ContextEngine,
  type ContextPacket,
  type ContextPacketRepository,
  type ImplementationEligibilityResolver,
  type ValidationReportRepository,
  type WorkflowStateRepository,
  type WorkspaceAnalyzer,
} from "@specta/graph"
import { createImplementationValidationEngine, type ImplementationValidationEngine } from "../validation/index.ts"
import type {
  FinalizeImplementationRequest,
  ImplementationFinalization,
  ImplementationPreparation,
  ImplementationWorkflowCoordinator,
  PrepareImplementationRequest,
} from "./contracts.ts"
import { deriveImplementationLinks } from "./outcome-links.ts"

export interface ImplementationWorkflowCoordinatorOptions {
  fileSystem?: FileSystem
  analyzer?: WorkspaceAnalyzer
  contextEngine?: ContextEngine
  contextPackets?: ContextPacketRepository
  eligibility?: ImplementationEligibilityResolver
  workflowState?: WorkflowStateRepository
  validator?: Pick<ImplementationValidationEngine, "evaluate">
  validationReports?: ValidationReportRepository
  now?: () => string
}

/** Creates the graph-backed prepare/finalize workflow surrounding coding-agent edits. */
export function createImplementationWorkflowCoordinator(
  options: ImplementationWorkflowCoordinatorOptions = {},
): ImplementationWorkflowCoordinator {
  const fileSystem = options.fileSystem ?? nodeFileSystem
  const analyzer = options.analyzer ?? createWorkspaceAnalyzer({ fileSystem })
  const contextEngine = options.contextEngine ?? createContextEngine({ fileSystem })
  const contextPackets = options.contextPackets ?? createContextPacketRepository(fileSystem)
  const eligibility = options.eligibility ?? createImplementationEligibilityResolver(fileSystem)
  const workflowState = options.workflowState ?? createWorkflowStateRepository(fileSystem)
  const validator = options.validator ?? createImplementationValidationEngine({ fileSystem })
  const validationReports = options.validationReports ?? createValidationReportRepository(fileSystem)
  const now = options.now ?? (() => new Date().toISOString())

  return {
    async prepare(request) {
      let epic = await eligibility.resolve(request.workspace, request.selector)
      const currentState = await workflowState.getEpicState(request.workspace, epic.epicId)
      const activeRun = currentState?.activeRunId
        ? await workflowState.getRun(request.workspace, currentState.activeRunId)
        : null
      if (currentState?.activeRunId && !activeRun) {
        throw new Error("Epic implementation state references a missing active run: " + currentState.activeRunId + ".")
      }
      if (activeRun && (activeRun.workflow !== "implement" || activeRun.targetId !== epic.epicId)) {
        throw new Error("The active Implementation Run targets a different Epic.")
      }
      if (activeRun?.status === "blocked") {
        throw new Error("Implementation Run is blocked and must be unblocked before it can resume: " + currentState?.activeRunId + ".")
      }
      if (activeRun?.status === "complete") {
        throw new Error("Epic implementation is already complete: " + epic.epicId + ".")
      }
      if (activeRun?.technicalDesignId && activeRun.technicalDesignId !== epic.designId) {
        epic = { ...epic, designId: activeRun.technicalDesignId }
      }

      let resumed = activeRun !== null
      let run = activeRun ?? initialRun(epic.epicId, epic.designId, now())
      let state = currentState ?? initialState(epic.epicId)
      const persistedContext = activeRun
        ? await contextPackets.get(request.workspace, currentState!.activeRunId!)
        : null
      if (!persistedContext) await analyzer.compile(request.workspace)
      if (!activeRun) {
        const deterministicRunId = runId(run, epic.designId, request.workspace.id)
        state = nextState(state, "ready", deterministicRunId)
        try {
          await workflowState.saveImplementationCheckpoint(request.workspace, {
            runId: deterministicRunId,
            run,
            state,
          })
        } catch (error) {
          const winningState = await workflowState.getEpicState(request.workspace, epic.epicId)
          const winningRun = winningState?.activeRunId
            ? await workflowState.getRun(request.workspace, winningState.activeRunId)
            : null
          if (!winningState || !winningRun || winningState.activeRunId !== deterministicRunId) throw error
          state = winningState
          run = winningRun
          resumed = true
        }
      }
      const implementationRunId = state.activeRunId
      if (!implementationRunId) throw new Error("Implementation preparation did not establish an active run.")
      const context = persistedContext ?? await contextEngine.compile(request.workspace, {
        epicId: epic.epicId,
        implementationRunId,
        workflow: "implement",
        ...(request.maxContextTokens ? { maxTokens: request.maxContextTokens } : {}),
      })
      if (run.status !== "in-progress") {
        run = {
          ...run,
          status: "in-progress",
          phase: "agent-implementation",
          revision: run.revision + 1,
        }
        state = nextState(state, "in-progress", implementationRunId)
        await workflowState.saveImplementationCheckpoint(request.workspace, {
          runId: implementationRunId,
          run,
          state,
        })
      }
      const previousValidation = run.validationReportId
        ? await validationReports.get(request.workspace, run.validationReportId)
        : null
      return {
        runId: implementationRunId,
        run,
        epic,
        context,
        resumed,
        ...(previousValidation ? { previousValidation } : {}),
      }
    },

    async finalize(request) {
      const usage = codingAgentTokenUsageSchema.parse(request.codingAgentTokenUsage ?? {
        source: "unavailable",
        reason: "Coding-agent host did not provide token telemetry.",
      })
      const currentRun = await workflowState.getRun(request.workspace, request.implementationRunId)
      if (!currentRun || currentRun.workflow !== "implement" || currentRun.targetKind !== "epic") {
        throw new Error("Implementation Run not found: " + request.implementationRunId + ".")
      }
      const currentState = await workflowState.getEpicState(request.workspace, currentRun.targetId)
      if (!currentState) throw new Error("Implementation Run has no Epic implementation state.")
      if (currentRun.status === "complete") {
        return terminalResult(request, currentRun, currentState, validationReports, contextPackets)
      }
      if (!currentState.activeRunId || currentState.activeRunId !== request.implementationRunId) {
        throw new Error("Implementation Run is not active for its Epic.")
      }
      if (currentRun.status === "prepared") {
        throw new Error("Implementation Run preparation is incomplete. Run prepare again before finalizing.")
      }
      if (currentRun.status === "blocked") {
        throw new Error("A blocked Implementation Run cannot be finalized.")
      }

      await analyzer.compile(request.workspace)
      const packet = await contextPackets.get(request.workspace, request.implementationRunId)
      if (!packet) throw new Error("Implementation Run has no persisted Context Packet.")
      const report = await validator.evaluate({
        workspace: request.workspace,
        epicId: currentRun.targetId,
        implementationRunId: request.implementationRunId,
        evidence: request.evidence,
        mode: "full",
      })
      const implementationLinks = deriveImplementationLinks(report, packet.technicalDesign.id)
      const completed = report.status === "passed"
      const run: WorkflowRun = {
        ...currentRun,
        status: completed ? "complete" : "validation-failed",
        phase: completed ? "complete" : "awaiting-fixes",
        revision: currentRun.revision + 1,
        validationReportId: report.id,
        tokenUsage: { codingAgent: usage },
        ...(completed ? { completedAt: now() } : {}),
      }
      const state: EpicImplementationState = {
        epicId: currentState.epicId,
        status: completed ? "complete" : "validation-failed",
        ...(!completed ? { activeRunId: request.implementationRunId } : {}),
        revision: currentState.revision + 1,
        validationSummary: validationSummary(report),
      }
      const producedNodeIds = implementationLinks.map((link) => link.sourceId)
      try {
        await workflowState.saveImplementationCheckpoint(request.workspace, {
          runId: request.implementationRunId,
          run,
          state,
          validationReport: report,
          producedNodeIds,
          implementationLinks,
        })
      } catch (error) {
        const [winningRun, winningState] = await Promise.all([
          workflowState.getRun(request.workspace, request.implementationRunId),
          workflowState.getEpicState(request.workspace, currentRun.targetId),
        ])
        if (!winningRun || !winningState || winningRun.revision < run.revision
          || !["complete", "validation-failed"].includes(winningRun.status)) throw error
        return terminalResult(request, winningRun, winningState, validationReports, contextPackets)
      }
      return finalizationResult(request.implementationRunId, run, state, report, implementationLinks, packet)
    },
  }
}

function initialRun(epicId: string, technicalDesignId: string, createdAt: string): WorkflowRun {
  return {
    workflow: "implement",
    targetId: epicId,
    targetKind: "epic",
    status: "prepared",
    phase: "compile-context",
    revision: 1,
    createdAt,
    technicalDesignId,
  }
}

function runId(run: WorkflowRun, designId: string, workspaceId: string): string {
  return "implementation_" + createHash("sha256")
    .update([workspaceId, run.targetId, designId].join(":"))
    .digest("hex")
    .slice(0, 16)
}

function initialState(epicId: string): EpicImplementationState {
  return { epicId: epicId as PlanningId, status: "planned", revision: 0 }
}

function nextState(
  state: EpicImplementationState,
  status: "ready" | "in-progress",
  activeRunId: string,
): EpicImplementationState {
  return { ...state, status, activeRunId, revision: state.revision + 1 }
}

function validationSummary(report: { summary: { passed: number; failed: number; skipped: number; warnings: number } }): string {
  const summary = report.summary
  return [
    summary.passed + " passed",
    summary.failed + " failed",
    summary.skipped + " skipped",
    summary.warnings + " warnings",
  ].join(", ")
}

async function terminalResult(
  request: FinalizeImplementationRequest,
  run: WorkflowRun,
  state: EpicImplementationState,
  reports: ValidationReportRepository,
  packets: ContextPacketRepository,
): Promise<ImplementationFinalization> {
  if (!run.validationReportId) throw new Error("Completed Implementation Run has no Validation Report.")
  const [report, packet] = await Promise.all([
    reports.get(request.workspace, run.validationReportId),
    packets.get(request.workspace, request.implementationRunId),
  ])
  if (!report || !packet) throw new Error("Completed Implementation Run provenance is incomplete.")
  return finalizationResult(
    request.implementationRunId,
    run,
    state,
    report,
    deriveImplementationLinks(report, packet.technicalDesign.id),
    packet,
  )
}

function finalizationResult(
  runId: string,
  run: WorkflowRun,
  state: EpicImplementationState,
  report: ValidationReport,
  implementationLinks: ReturnType<typeof deriveImplementationLinks>,
  packet: ContextPacket,
): ImplementationFinalization {
  return {
    runId,
    run,
    state,
    report,
    implementationLinks,
    tokenUsage: {
      context: {
        estimatedTokens: packet.tokenUsage.estimated,
        budgetTokens: packet.tokenUsage.budget,
      },
      codingAgent: run.tokenUsage?.codingAgent ?? {
        source: "unavailable",
        reason: "Coding-agent host did not provide token telemetry.",
      },
    },
  }
}
