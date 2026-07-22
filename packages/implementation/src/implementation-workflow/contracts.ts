import type {
  CodingAgentTokenUsage,
  EpicImplementationState,
  WorkflowRun,
  Workspace,
} from "@specta/core"
import type { ValidationEvidence, ValidationReport } from "@specta/core/validation"
import type {
  ContextPacket,
  EligibleEpic,
  ImplementationEpicSelector,
  ImplementationLink,
} from "@specta/graph"

export interface PrepareImplementationRequest {
  workspace: Workspace
  selector: ImplementationEpicSelector
  maxContextTokens?: number
}

/** Persisted handoff from Specta to the active coding agent. */
export interface ImplementationPreparation {
  runId: string
  run: WorkflowRun
  epic: EligibleEpic
  context: ContextPacket
  resumed: boolean
  previousValidation?: ValidationReport
}

export interface FinalizeImplementationRequest {
  workspace: Workspace
  implementationRunId: string
  evidence: ValidationEvidence
  codingAgentTokenUsage?: CodingAgentTokenUsage
}

export interface ImplementationTokenUsage {
  context: { estimatedTokens: number; budgetTokens: number }
  codingAgent: CodingAgentTokenUsage
}

/** Authoritative implementation outcome, including run-level token accounting. */
export interface ImplementationFinalization {
  runId: string
  run: WorkflowRun
  state: EpicImplementationState
  report: ValidationReport
  implementationLinks: ImplementationLink[]
  tokenUsage: ImplementationTokenUsage
}

/** Coordinates the two deterministic phases surrounding coding-agent edits. */
export interface ImplementationWorkflowCoordinator {
  prepare(request: PrepareImplementationRequest): Promise<ImplementationPreparation>
  finalize(request: FinalizeImplementationRequest): Promise<ImplementationFinalization>
}
