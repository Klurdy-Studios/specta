import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PlanningState, TechnicalDesign, Workspace } from "@specta/core"
import { validationReportSchema, type ValidationReport } from "@specta/core/validation"
import {
  createPlanningGraphRepository,
  createSqliteWorkspaceGraphProvider,
  createTechnicalDesignGraphRepository,
  createWorkflowStateRepository,
} from "@specta/graph"
import { afterEach, expect, it } from "vitest"
import {
  createImplementationWorkflowCoordinator,
  renderImplementationFinalization,
} from "../src/index.ts"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

it("prepares idempotently and atomically completes one Epic with token telemetry and traceability", async () => {
  const workspace = await temporaryWorkspace()
  const provider = createSqliteWorkspaceGraphProvider()
  const planning = planningFixture()
  const design = designFixture()
  await createPlanningGraphRepository(undefined, provider).savePlanningState(workspace, planning)
  await createTechnicalDesignGraphRepository(undefined, provider).save(workspace, design)
  await provider.withGraph(workspace, (graph) => graph.projections.apply({
    key: "implementation-test-nodes",
    nodes: [
      { id: "file_api", kind: "File", props: fileProps("src/api.ts", "source") },
      { id: "test_api", kind: "Test", props: testProps() },
    ],
    edges: [],
  }))
  const report = reportFixture()
  let clockTick = 0
  const coordinator = createImplementationWorkflowCoordinator({
    analyzer: { compile: async () => ({}) as never },
    validator: { evaluate: async (request) => ({ ...report, implementationRunId: request.implementationRunId }) },
    workflowState: createWorkflowStateRepository(undefined, provider),
    eligibility: {
      resolve: async (_workspace, selector) => {
        expect(selector).toEqual({ kind: "next" })
        return { epicId: "epic_api", title: "API", designId: "design_api", roadmapIndex: 0 }
      },
    },
    now: () => new Date(Date.UTC(2026, 6, 21, 12, 0, clockTick++)).toISOString(),
  })

  const first = await coordinator.prepare({ workspace, selector: { kind: "next" } })
  const resumed = await coordinator.prepare({ workspace, selector: { kind: "next" } })
  expect(resumed.runId).toBe(first.runId)
  expect(resumed.resumed).toBe(true)
  expect(resumed.context).toEqual(first.context)

  const usage = {
    source: "measured" as const,
    inputTokens: 1_200,
    cachedInputTokens: 400,
    outputTokens: 300,
    reasoningTokens: 100,
    totalTokens: 1_500,
  }
  const finalizeRequest = {
    workspace,
    implementationRunId: first.runId,
    evidence: { epicId: "epic_api", criteria: [{ criterionId: "criterion_api", tests: [{ path: "test/api.test.ts" }] }] },
    codingAgentTokenUsage: usage,
  }
  const [result, concurrent] = await Promise.all([
    coordinator.finalize(finalizeRequest),
    coordinator.finalize(finalizeRequest),
  ])
  expect(concurrent).toEqual(result)
  expect(result.run.status).toBe("complete")
  expect(result.tokenUsage).toEqual({
    context: {
      estimatedTokens: first.context.tokenUsage.estimated,
      budgetTokens: first.context.tokenUsage.budget,
    },
    codingAgent: usage,
  })
  expect(result.implementationLinks).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "IMPLEMENTS", sourceId: "file_api", targetId: "epic_api" }),
    expect.objectContaining({ kind: "VALIDATES", sourceId: "test_api", targetId: "criterion_api" }),
  ]))
  expect(result.run.tokenUsage).toEqual({ codingAgent: usage })
  expect(renderImplementationFinalization(result)).toContain("Coding-agent total: 1500")

  const repeated = await coordinator.finalize({
    workspace,
    implementationRunId: first.runId,
    evidence: { epicId: "epic_api", criteria: [{ criterionId: "criterion_api", tests: [{ path: "test/api.test.ts" }] }] },
    codingAgentTokenUsage: usage,
  })
  expect(repeated).toEqual(result)
  await provider.withGraph(workspace, async (graph) => {
    const fileLinks = await graph.queries.neighbors({
      nodeId: "file_api",
      direction: "outgoing",
      edgeKinds: ["IMPLEMENTS"],
    })
    expect(fileLinks.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(["epic_api", "design_api"]))
    const testLinks = await graph.queries.neighbors({
      nodeId: "test_api",
      direction: "outgoing",
      edgeKinds: ["VALIDATES"],
    })
    expect(testLinks.nodes.map((node) => node.id)).toContain("criterion_api")
  })
})

it("persists actionable validation failure and resumes the same run", async () => {
  const workspace = await temporaryWorkspace()
  const provider = createSqliteWorkspaceGraphProvider()
  await createPlanningGraphRepository(undefined, provider).savePlanningState(workspace, planningFixture())
  await createTechnicalDesignGraphRepository(undefined, provider).save(workspace, designFixture())
  await provider.withGraph(workspace, (graph) => graph.projections.apply({
    key: "implementation-test-nodes",
    nodes: [
      { id: "file_api", kind: "File", props: fileProps("src/api.ts", "source") },
      { id: "test_api", kind: "Test", props: testProps() },
    ],
    edges: [],
  }))
  const failed = { ...reportFixture(), status: "failed" as const }
  failed.checks = failed.checks.map((check) => check.category === "acceptance-criterion"
    ? { ...check, status: "failed" as const, message: "Acceptance test failed." }
    : check)
  failed.summary = { passed: failed.checks.length - 1, failed: 1, skipped: 0, warnings: 0 }
  const report = validationReportSchema.parse(failed)
  let candidateDesignId = "design_api"
  const coordinator = createImplementationWorkflowCoordinator({
    analyzer: { compile: async () => ({}) as never },
    validator: { evaluate: async (request) => ({ ...report, implementationRunId: request.implementationRunId }) },
    workflowState: createWorkflowStateRepository(undefined, provider),
    eligibility: { resolve: async () => ({ epicId: "epic_api", title: "API", designId: candidateDesignId, roadmapIndex: 0 }) },
  })
  const prepared = await coordinator.prepare({ workspace, selector: { kind: "epic", epicId: "epic_api" } })
  const result = await coordinator.finalize({
    workspace,
    implementationRunId: prepared.runId,
    evidence: { epicId: "epic_api", criteria: [{ criterionId: "criterion_api", tests: [{ path: "test/api.test.ts" }] }] },
    codingAgentTokenUsage: {
      source: "reported",
      inputTokens: 500,
      cachedInputTokens: 0,
      outputTokens: 100,
      reasoningTokens: 20,
      totalTokens: 600,
    },
  })
  expect(result.state).toMatchObject({ status: "validation-failed", activeRunId: prepared.runId })
  expect(result.implementationLinks).toEqual([])
  candidateDesignId = "design_api_v2"
  await createTechnicalDesignGraphRepository(undefined, provider).saveMany(workspace, [
    { ...designFixture(), status: "superseded" },
    {
      ...designFixture(),
      id: "design_api_v2" as TechnicalDesign["id"],
      revision: 2,
    },
  ])
  const resumed = await coordinator.prepare({ workspace, selector: { kind: "epic", epicId: "epic_api" } })
  expect(resumed.runId).toBe(prepared.runId)
  expect(resumed.run.status).toBe("in-progress")
  expect(resumed.previousValidation?.id).toBe(report.id)
  expect(resumed.epic.designId).toBe("design_api")
  expect(resumed.context.technicalDesign.id).toBe("design_api")
})

async function temporaryWorkspace(): Promise<Workspace> {
  const rootPath = await mkdtemp(join(tmpdir(), "specta-implement-"))
  directories.push(rootPath)
  return {
    schemaVersion: 1,
    id: "ws_implement" as Workspace["id"],
    rootPath,
    createdAt: "2026-07-21T00:00:00.000Z",
    packageManager: "pnpm",
    projects: [],
    artifacts: {},
    workflow: { skillTargets: [], manifestPath: ".specta/workflows/manifest.json" },
  }
}

function planningFixture(): PlanningState {
  return {
    brief: "Build an API.",
    completedStages: ["foundation", "architecture", "roadmap", "epics"],
    vision: { id: "vision", title: "API", problem: "Missing API.", audience: "Users.", outcome: "Working API." },
    constitution: { id: "constitution", principles: ["Test behavior."] },
    architecture: { id: "architecture", overview: "API system.", components: ["API"] },
    roadmap: { id: "roadmap", milestones: [{ title: "MVP", objective: "Deliver API.", outcomes: ["API works."] }] },
    epics: [{
      id: "epic_api",
      title: "API",
      goal: "Deliver API.",
      roadmapMilestone: "MVP",
      stories: [{
        id: "story_api",
        title: "Call API",
        description: "A user calls the API.",
        acceptanceCriteria: [{ id: "criterion_api", description: "API responds." }],
        tasks: [{ id: "task_api", title: "Implement API", description: "Implement it." }],
      }],
    }],
    relationships: [
      { type: "DEPENDS_ON", sourceId: "architecture", targetId: "vision" },
      { type: "DEPENDS_ON", sourceId: "architecture", targetId: "constitution" },
      { type: "DEPENDS_ON", sourceId: "roadmap", targetId: "architecture" },
      { type: "DEPENDS_ON", sourceId: "epic_api", targetId: "roadmap" },
      { type: "IMPLEMENTS", sourceId: "epic_api", targetId: "architecture" },
      { type: "CONTAINS", sourceId: "epic_api", targetId: "story_api" },
      { type: "CONTAINS", sourceId: "story_api", targetId: "criterion_api" },
      { type: "CONTAINS", sourceId: "story_api", targetId: "task_api" },
    ],
  } as PlanningState
}

function designFixture(): TechnicalDesign {
  return {
    id: "design_api" as TechnicalDesign["id"],
    targetId: "epic_api" as TechnicalDesign["targetId"],
    status: "scaffolded",
    revision: 1,
    summary: "API design.",
    target: { kind: "new", name: "api", rootPath: "", projectKind: "service", framework: { language: "typescript", framework: "none", toolchain: "pnpm" } },
    profile: { name: "api", rootPath: "", state: "blank", language: "typescript", framework: "none", toolchain: "pnpm", packageManager: "pnpm", sourceRoots: ["src"], evidence: [], source: "technical-design" },
    modules: [{ name: "API", path: "src", purpose: "Serve API.", architectureComponents: ["API"], files: [{ path: "src/api.ts", kind: "source", language: "typescript", ownership: "epic", exports: [{ name: "Api", kind: "class", purpose: "API implementation." }] }] }],
    dependencies: [],
    impactRequests: [],
    scaffoldedPaths: ["src/api.ts"],
  }
}

function reportFixture(): ValidationReport {
  const checks: ValidationReport["checks"] = [
    check("requirement", "epic_api", "epic"),
    check("requirement", "story_api", "story"),
    check("acceptance-criterion", "criterion_api", "criterion", ["test_api"]),
    check("test", "test_api", "test"),
    check("architecture", "design_api", "technical-design"),
    { ...check("architecture", "architecture", "component"), subject: { kind: "component", id: "architecture", name: "API" } },
    { ...check("file", "file_api", "source"), subject: { kind: "source", id: "file_api", path: "src/api.ts" } },
  ]
  return validationReportSchema.parse({
    schemaVersion: 1,
    id: "validation_api",
    epicId: "epic_api",
    implementationRunId: "implementation_ignored",
    mode: "full",
    contextFingerprint: "a".repeat(64),
    sourceFingerprint: "b".repeat(64),
    status: "passed",
    checks,
    commands: [{
      command: { kind: "test", executable: "pnpm", arguments: ["test"], cwd: ".", testPaths: ["test/api.test.ts"], timeoutMs: 1_000 },
      status: "passed",
      exitCode: 0,
      timedOut: false,
      stdout: "passed",
      stderr: "",
    }],
    summary: { passed: checks.length, failed: 0, skipped: 0, warnings: 0 },
  })
}

function check(
  category: ValidationReport["checks"][number]["category"],
  id: string,
  kind: string,
  evidenceNodeIds: string[] = [id],
): ValidationReport["checks"][number] {
  return { id: "check_" + category + "_" + id, category, subject: { kind, id }, status: "passed", severity: "error", message: "Passed.", evidenceNodeIds }
}

function fileProps(path: string, fileKind: "source" | "test") {
  return { path, projectId: "project_api", fileKind }
}

function testProps() {
  return { path: "test/api.test.ts", name: "API responds", framework: "vitest" }
}
