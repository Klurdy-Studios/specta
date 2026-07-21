import type { ValidationReport } from "@specta/core/validation"

/** Renders one Validation Report for developers and coding agents. */
export function renderValidationReport(report: ValidationReport): string {
  const lines = [
    "# Validation Report — " + report.epicId,
    "",
    "Status: " + report.status,
    "Mode: " + report.mode,
    "Report: " + report.id,
    "",
    "## Summary",
    "",
    "- Passed: " + report.summary.passed,
    "- Failed: " + report.summary.failed,
    "- Skipped: " + report.summary.skipped,
    "- Warnings: " + report.summary.warnings,
    "",
    "## Checks",
    "",
  ]
  for (const check of report.checks) {
    const target = check.subject.path ?? check.subject.name ?? check.subject.id ?? check.subject.kind
    lines.push("- [" + check.status + "] " + check.category + " — " + target + ": " + check.message)
  }
  lines.push("", "## Commands", "")
  if (report.commands.length === 0) lines.push("- No commands executed.")
  for (const result of report.commands) {
    lines.push("- [" + result.status + "] " + result.command.executable + " " + result.command.arguments.join(" "))
  }
  return lines.join("\n") + "\n"
}
