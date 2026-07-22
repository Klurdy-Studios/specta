import { describe, expect, it } from "vitest"
import {
  codingAgentTokenUsageSchema,
  foundationDraftSchema,
  epicsDraftSchema,
  roadmapDraftSchema,
  technicalDesignSchema,
  workspaceSchema,
} from "../src/index.js"
import { validationEvidenceSchema, validationReportSchema } from "../src/validation/index.js"

describe("canonical schemas", () => {
  it("validates coding-agent token breakdown arithmetic", () => {
    expect(codingAgentTokenUsageSchema.parse({
      source: "measured",
      inputTokens: 100,
      cachedInputTokens: 40,
      outputTokens: 25,
      reasoningTokens: 10,
      totalTokens: 125,
    })).toMatchObject({ totalTokens: 125 })
    expect(codingAgentTokenUsageSchema.parse({
      source: "unavailable",
      reason: "The host does not expose telemetry.",
    })).toMatchObject({ source: "unavailable" })
    expect(() => codingAgentTokenUsageSchema.parse({
      source: "reported",
      inputTokens: 100,
      cachedInputTokens: 101,
      outputTokens: 25,
      reasoningTokens: 10,
      totalTokens: 125,
    })).toThrow("Cached input tokens cannot exceed input tokens")
    expect(() => codingAgentTokenUsageSchema.parse({
      source: "reported",
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 25,
      reasoningTokens: 10,
      totalTokens: 124,
    })).toThrow("Total tokens must equal input plus output tokens")
  })

  it("rejects incomplete Foundation drafts", () => {
    expect(() => foundationDraftSchema.parse({
      vision: { title: "Specta", problem: "Planning is fragmented.", audience: "Developers" },
      constitution: { principles: ["Keep the graph authoritative."] },
    })).toThrow()
  })

  it("rejects invalid workspace configuration", () => {
    expect(() => workspaceSchema.parse({
      schemaVersion: 1,
      id: "ws_test",
      rootPath: "/workspace",
      createdAt: "not-a-date",
      packageManager: "pnpm",
      projects: [],
      artifacts: {},
      workflow: { skillTargets: ["codex", "codex"], manifestPath: ".specta/workflows/manifest.json" },
    })).toThrow()
  })

  it("rejects duplicate Roadmap milestone titles and outcomes", () => {
    expect(() => roadmapDraftSchema.parse({
      milestones: [
        { title: "MVP", objective: "Deliver the MVP.", outcomes: ["Users can plan work.", "users can plan work."] },
      ],
    })).toThrow("Roadmap milestone outcomes must be unique")
    expect(() => roadmapDraftSchema.parse({
      milestones: [
        { title: "MVP", objective: "Deliver the MVP.", outcomes: ["Users can plan work."] },
        { title: "mvp", objective: "Repeat the MVP.", outcomes: ["The MVP is repeated."] },
      ],
    })).toThrow("Roadmap milestone titles must be unique")
    expect(() => roadmapDraftSchema.parse({
      milestones: [{ title: "MVP", objective: "", outcomes: ["Delivered."] }],
    })).toThrow()
    expect(() => roadmapDraftSchema.parse({
      milestones: [{ title: "MVP", objective: "Deliver it.", outcomes: [] }],
    })).toThrow()
    expect(() => roadmapDraftSchema.parse({
      milestones: [{ title: "MVP", objective: "Deliver it.", outcomes: ["Delivered."], status: "planned" }],
    })).toThrow()
  })

  it("rejects duplicate or incomplete Epics content", () => {
    const story = {
      title: "Create work",
      description: "A user can create work.",
      acceptanceCriteria: ["Work is persisted."],
      tasks: [{ title: "Define creation", description: "Define the creation behavior." }],
    }
    expect(() => epicsDraftSchema.parse({
      epics: [
        { title: "Planning", goal: "Plan work.", roadmapMilestone: "MVP", stories: [story] },
        { title: "planning", goal: "Repeat work.", roadmapMilestone: "MVP", stories: [story] },
      ],
    })).toThrow("Epic titles must be unique")
    expect(() => epicsDraftSchema.parse({
      epics: [{
        title: "Planning",
        goal: "Plan work.",
        roadmapMilestone: "MVP",
        stories: [{ ...story, acceptanceCriteria: ["Done.", "done."] }],
      }],
    })).toThrow("Story acceptance criteria must be unique")
    expect(() => epicsDraftSchema.parse({
      epics: [{
        title: "Planning",
        goal: "Plan work.",
        roadmapMilestone: "MVP",
        stories: [story, { ...story, title: "create work" }],
      }],
    })).toThrow("Epic story titles must be unique")
    expect(() => epicsDraftSchema.parse({
      epics: [{
        title: "Planning",
        goal: "Plan work.",
        roadmapMilestone: "MVP",
        stories: [{ ...story, tasks: [story.tasks[0]!, { ...story.tasks[0]!, title: "define creation" }] }],
      }],
    })).toThrow("Story task titles must be unique")
    expect(() => epicsDraftSchema.parse({
      epics: [{ title: "Planning", goal: "Plan work.", roadmapMilestone: "MVP", stories: [] }],
    })).toThrow()
  })

  it("rejects duplicate Technical Design file paths", () => {
    const file = { path: "src/session/index.ts", kind: "source", exports: [] }
    expect(() => technicalDesignSchema.parse({
      id: "design_session",
      targetId: "epic_session",
      status: "draft",
      revision: 1,
      target: {
        kind: "new",
        name: "application",
        rootPath: "",
        projectKind: "application",
        framework: { language: "typescript", framework: "none", toolchain: "none" },
      },
      profile: {
        name: "application",
        rootPath: "",
        state: "blank",
        language: "typescript",
        framework: "none",
        toolchain: "none",
        packageManager: "unknown",
        sourceRoots: ["src"],
        evidence: [],
        source: "technical-design",
      },
      summary: "Design the session boundary.",
      modules: [
        { name: "Session", path: "src/session", purpose: "Session boundary.", files: [file] },
        { name: "Auth", path: "src/auth", purpose: "Auth boundary.", files: [file] },
      ],
      dependencies: [],
      impactRequests: [],
    })).toThrow("Technical Design file paths must be unique")
  })

  it("enforces validation evidence and report outcome invariants", () => {
    expect(() => validationEvidenceSchema.parse({
      epicId: "epic",
      criteria: [
        { criterionId: "criterion", tests: [{ path: "src/a.test.ts" }] },
        { criterionId: "criterion", tests: [{ path: "src/b.test.ts" }] },
      ],
    })).toThrow("Criterion evidence IDs must be unique")
    expect(() => validationEvidenceSchema.parse({
      epicId: "epic",
      criteria: [{
        criterionId: "criterion",
        tests: [{ path: "src/a.test.ts" }, { path: "src/a.test.ts" }],
      }],
    })).toThrow("Criterion test evidence must be unique")
    expect(() => validationReportSchema.parse({
      schemaVersion: 1,
      id: "report",
      epicId: "epic",
      mode: "full",
      contextFingerprint: "c".repeat(64),
      sourceFingerprint: "a".repeat(64),
      status: "passed",
      checks: [{
        id: "check",
        category: "test",
        subject: { kind: "test" },
        status: "failed",
        severity: "error",
        message: "Test failed.",
        evidenceNodeIds: [],
      }],
      commands: [],
      summary: { passed: 0, failed: 1, skipped: 0, warnings: 0 },
    })).toThrow("Validation report status does not match blocking checks")
    expect(() => validationReportSchema.parse({
      schemaVersion: 1,
      id: "empty-report",
      epicId: "epic",
      mode: "full",
      contextFingerprint: "c".repeat(64),
      sourceFingerprint: "b".repeat(64),
      status: "passed",
      checks: [{
        id: "check",
        category: "requirement",
        subject: { kind: "epic", id: "epic" },
        status: "passed",
        severity: "error",
        message: "Epic passed.",
        evidenceNodeIds: ["epic"],
      }],
      commands: [],
      summary: { passed: 1, failed: 0, skipped: 0, warnings: 0 },
    })).toThrow("A passing report requires a successful test command")
  })
})
