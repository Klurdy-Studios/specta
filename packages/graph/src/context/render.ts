import type { ContextPacket } from "./contracts.ts"

/** Renders a compiled packet as concise instructions for an active coding agent. */
export function renderContextPacket(packet: ContextPacket): string {
  const lines = [
    "# Implementation context — " + packet.epic.title,
    "",
    "Implement only Epic `" + packet.epicId + "`. Use your coding-agent tools to inspect the referenced files before editing.",
    "",
    "## Goal",
    "",
    packet.epic.goal,
    "",
    "## Stories and acceptance criteria",
    "",
  ]
  for (const story of packet.stories) {
    lines.push("### " + story.title, "", story.description, "")
    for (const criterion of story.acceptanceCriteria) lines.push("- Acceptance: " + criterion.description)
    for (const task of story.tasks) lines.push("- Task: " + task.title + " — " + task.description)
    lines.push("")
  }
  lines.push("## Architecture constraints", "", packet.architecture.overview, "")
  for (const principle of packet.architecture.principles) lines.push("- Principle: " + principle)
  for (const component of packet.architecture.components) lines.push("- Component: " + component)
  if (packet.architecture.guidance) lines.push("- Guidance: " + packet.architecture.guidance)
  lines.push("", "## Approved Technical Design", "", packet.technicalDesign.summary, "")
  for (const module of packet.technicalDesign.modules) {
    lines.push("### " + module.name + " (`" + module.path + "`)", "", module.purpose, "")
    for (const file of module.files) {
      lines.push("- `" + file.path + "` (" + file.kind + ", " + file.ownership + ")")
      for (const symbol of file.exports) {
        lines.push("  - `" + (symbol.signature ?? symbol.name) + "` — " + symbol.purpose)
      }
    }
    lines.push("")
  }
  lines.push("## Dependencies", "")
  if (packet.dependencies.length === 0) lines.push("- None.")
  for (const dependency of packet.dependencies) {
    lines.push("- " + dependency.kind + ": " + dependency.label
      + (dependency.path ? " (`" + dependency.path + "`)" : "")
      + (dependency.status ? " [" + dependency.status + "]" : "")
      + (dependency.reason ? " — " + dependency.reason : ""))
  }
  lines.push("", "## Relevant source and tests", "")
  for (const file of packet.sourceFiles) lines.push("- `" + file.path + "` — " + file.relevance)
  for (const symbol of packet.symbols) lines.push("- Symbol `" + (symbol.signature ?? symbol.name) + "` in `" + (symbol.path ?? "unknown") + "`")
  for (const test of packet.tests) lines.push("- Test `" + test.name + "` in `" + test.path + "`")
  lines.push("", "## Blast radius", "")
  lines.push(
    "- Direct consumers: " + packet.blastRadius.totals.directConsumers,
    "- Transitive consumers: " + packet.blastRadius.totals.transitiveConsumers,
    "- Affected tests: " + packet.blastRadius.totals.affectedTests,
    "- Dependent Epics: " + packet.blastRadius.totals.dependentEpics,
  )
  for (const impact of packet.blastRadius.directConsumers) lines.push(renderImpact("Direct", impact))
  for (const impact of packet.blastRadius.transitiveConsumers) lines.push(renderImpact("Transitive", impact))
  for (const impact of packet.blastRadius.affectedTests) lines.push(renderImpact("Test", impact))
  for (const impact of packet.blastRadius.dependentEpics) lines.push(renderImpact("Epic", impact))
  if (packet.blastRadius.truncated) lines.push("- Additional impacted entities were omitted from this token-bounded packet.")
  lines.push(
    "",
    "## Completion conditions",
    "",
    "- Implement every listed task and acceptance criterion.",
    "- Preserve the architecture constraints and approved Technical Design.",
    "- Add or update relevant tests.",
    "- Run the repository's checks and tests before finalization.",
    "",
    "Estimated context: " + packet.tokenUsage.estimated + "/" + packet.tokenUsage.budget + " tokens.",
  )
  if (packet.tokenUsage.overBudget) lines.push("Required context exceeds the requested budget; no required content was removed.")
  for (const diagnostic of packet.diagnostics) lines.push("Diagnostic " + diagnostic.code + ": " + diagnostic.message)
  return lines.join("\n") + "\n"
}

function renderImpact(label: string, impact: ContextPacket["blastRadius"]["directConsumers"][number]): string {
  const target = impact.path ? "`" + impact.path + "`" : impact.name ? "`" + impact.name + "`" : "`" + impact.nodeId + "`"
  return "- " + label + ": " + target + " via " + impact.reason + " (depth " + impact.depth + ")"
}
