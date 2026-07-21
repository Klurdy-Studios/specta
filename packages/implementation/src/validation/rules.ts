import { createHash } from "node:crypto"
import {
  validationReportSchema,
  type ValidationCheck,
  type ValidationCommandResult,
  type ValidationReport,
} from "@specta/core/validation"

export type ValidationCheckInput = Omit<ValidationCheck, "id" | "evidenceNodeIds"> & {
  evidenceNodeIds?: string[]
}

/** Creates a stable validation check from its category, subject and outcome. */
export function validationCheck(input: ValidationCheckInput): ValidationCheck {
  const identity = JSON.stringify({ category: input.category, subject: input.subject })
  return {
    id: "check_" + createHash("sha256").update(identity).digest("hex").slice(0, 16),
    ...input,
    evidenceNodeIds: [...new Set(input.evidenceNodeIds ?? [])].sort(),
  }
}

/** Builds and validates a report whose status is derived only from blocking checks. */
export function validationReport(input: {
  id: string
  epicId: string
  implementationRunId?: string
  mode: "full" | "structural"
  contextFingerprint: string
  sourceFingerprint: string
  checks: ValidationCheck[]
  commands: ValidationCommandResult[]
}): ValidationReport {
  const summary = {
    passed: input.checks.filter((check) => check.status === "passed").length,
    failed: input.checks.filter((check) => check.status === "failed").length,
    skipped: input.checks.filter((check) => check.status === "skipped").length,
    warnings: input.checks.filter((check) => check.severity === "warning" && check.status !== "passed").length,
  }
  const status = input.checks.some((check) => check.status !== "passed" && check.severity === "error")
    ? "failed"
    : "passed"
  return validationReportSchema.parse({
    schemaVersion: 1,
    ...input,
    status,
    checks: [...input.checks].sort((left, right) => left.id.localeCompare(right.id)),
    summary,
  })
}
