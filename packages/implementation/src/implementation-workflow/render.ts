import type { ImplementationFinalization, ImplementationPreparation } from "./contracts.ts"

/** Renders the concise coding-agent handoff for one prepared implementation run. */
export function renderImplementationPreparation(value: ImplementationPreparation): string {
  return [
    "# Implementation Run " + value.runId,
    "",
    "Epic: " + value.epic.epicId + " — " + value.epic.title,
    "Status: " + value.run.status + (value.resumed ? " (resumed)" : ""),
    "Technical Design: " + value.context.technicalDesign.id,
    "Context tokens: ~" + value.context.tokenUsage.estimated + " / " + value.context.tokenUsage.budget,
    "Relevant files: " + value.context.sourceFiles.length,
    "Relevant tests: " + value.context.tests.length,
    "Blast radius: " + (
      value.context.blastRadius.totals.directConsumers
      + value.context.blastRadius.totals.transitiveConsumers
      + value.context.blastRadius.totals.affectedTests
      + value.context.blastRadius.totals.dependentEpics
    ) + " node(s)",
    "",
    "Use the JSON form of this preparation for the complete implementation packet.",
  ].join("\n")
}

/** Renders validation outcome and the coding agent's reported token breakdown. */
export function renderImplementationFinalization(value: ImplementationFinalization): string {
  const usage = value.tokenUsage
  const lines = [
    "# Implementation Run " + value.runId,
    "",
    "Status: " + value.run.status,
    "Validation: " + value.report.status,
    "Checks: " + value.report.summary.passed + " passed, " + value.report.summary.failed + " failed, "
      + value.report.summary.skipped + " skipped, " + value.report.summary.warnings + " warnings",
    "Implementation relationships: " + value.implementationLinks.length,
  ]
  lines.push(
    "",
    "## Token usage",
    "",
    "Source: " + usage.codingAgent.source,
    "Specta Context Packet estimate: " + usage.context.estimatedTokens + " / " + usage.context.budgetTokens,
    ...(usage.codingAgent.source === "unavailable"
      ? ["Coding-agent usage: unavailable — " + usage.codingAgent.reason]
      : [
        "Coding-agent input: " + usage.codingAgent.inputTokens,
        "Cached input: " + usage.codingAgent.cachedInputTokens,
        "Coding-agent output: " + usage.codingAgent.outputTokens,
        "Reasoning output: " + usage.codingAgent.reasoningTokens,
        "Coding-agent total: " + usage.codingAgent.totalTokens,
      ]),
  )
  return lines.join("\n")
}
