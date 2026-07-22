import { z } from "zod"

const text = z.string().trim().min(1)

export const validationCheckStatusSchema = z.enum(["passed", "failed", "skipped"])
export const validationSeveritySchema = z.enum(["error", "warning"])
export const validationCategorySchema = z.enum([
  "requirement",
  "acceptance-criterion",
  "architecture",
  "file",
  "symbol",
  "dependency",
  "test",
  "command",
])

export const validationCheckSchema = z.object({
  id: text,
  category: validationCategorySchema,
  subject: z.object({
    kind: text,
    id: text.optional(),
    name: text.optional(),
    path: text.optional(),
  }).strict(),
  status: validationCheckStatusSchema,
  severity: validationSeveritySchema,
  message: text,
  evidenceNodeIds: z.array(text),
}).strict()
export type ValidationCheck = z.infer<typeof validationCheckSchema>

export const validationCommandSchema = z.object({
  kind: z.enum(["test", "check", "lint"]),
  executable: text,
  arguments: z.array(z.string()),
  cwd: text,
  projectId: text.optional(),
  testPaths: z.array(text).min(1).optional(),
  timeoutMs: z.number().int().positive(),
}).strict().superRefine((command, context) => {
  if (command.testPaths !== undefined && command.kind !== "test") {
    context.addIssue({ code: "custom", message: "Only test commands may target test paths.", path: ["testPaths"] })
  }
})
export type ValidationCommand = z.infer<typeof validationCommandSchema>

export const validationCommandResultSchema = z.object({
  command: validationCommandSchema,
  status: z.enum(["passed", "failed"]),
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  stdout: z.string(),
  stderr: z.string(),
}).strict()
export type ValidationCommandResult = z.infer<typeof validationCommandResultSchema>

export const criterionTestEvidenceSchema = z.object({
  path: text,
  name: text.optional(),
}).strict()
export const criterionEvidenceSchema = z.object({
  criterionId: text,
  tests: z.array(criterionTestEvidenceSchema).min(1),
}).strict().superRefine((criterion, context) => {
  const identities = criterion.tests.map((test) => test.path + "\0" + (test.name ?? ""))
  if (new Set(identities).size !== identities.length) {
    context.addIssue({ code: "custom", message: "Criterion test evidence must be unique.", path: ["tests"] })
  }
})
export const validationEvidenceSchema = z.object({
  epicId: text,
  criteria: z.array(criterionEvidenceSchema),
}).strict().superRefine((evidence, context) => {
  const ids = evidence.criteria.map((criterion) => criterion.criterionId)
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "Criterion evidence IDs must be unique.", path: ["criteria"] })
  }
})
export type ValidationEvidence = z.infer<typeof validationEvidenceSchema>

export const validationReportSchema = z.object({
  schemaVersion: z.literal(1),
  id: text,
  epicId: text,
  implementationRunId: text.optional(),
  mode: z.enum(["full", "structural"]),
  contextFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["passed", "failed"]),
  checks: z.array(validationCheckSchema).min(1),
  commands: z.array(validationCommandResultSchema),
  summary: z.object({
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
  }).strict(),
}).strict().superRefine((report, context) => {
  if (new Set(report.checks.map((check) => check.id)).size !== report.checks.length) {
    context.addIssue({ code: "custom", message: "Validation check IDs must be unique.", path: ["checks"] })
  }
  const count = (status: z.infer<typeof validationCheckStatusSchema>) =>
    report.checks.filter((check) => check.status === status).length
  const expected = {
    passed: count("passed"),
    failed: count("failed"),
    skipped: count("skipped"),
    warnings: report.checks.filter((check) => check.severity === "warning" && check.status !== "passed").length,
  }
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    if (report.summary[key] !== expected[key]) {
      context.addIssue({ code: "custom", message: "Validation summary does not match checks.", path: ["summary", key] })
    }
  }
  const failed = report.checks.some((check) => check.status !== "passed" && check.severity === "error")
  if (report.status !== (failed ? "failed" : "passed")) {
    context.addIssue({ code: "custom", message: "Validation report status does not match blocking checks.", path: ["status"] })
  }
  if (report.mode === "structural" && report.status === "passed") {
    context.addIssue({ code: "custom", message: "Structural validation cannot authorize completion.", path: ["status"] })
  }
  if (report.commands.some((result) => result.status === "failed") && report.status === "passed") {
    context.addIssue({ code: "custom", message: "Failed commands cannot produce a passing report.", path: ["status"] })
  }
  if (report.status === "passed" && !report.commands.some((result) =>
    result.command.kind === "test" && result.status === "passed"
  )) {
    context.addIssue({ code: "custom", message: "A passing report requires a successful test command.", path: ["commands"] })
  }
})
export type ValidationReport = z.infer<typeof validationReportSchema>

/** Injectable, shell-free execution boundary for project validation scripts. */
export interface ValidationCommandRunner {
  run(command: ValidationCommand): Promise<ValidationCommandResult>
}
