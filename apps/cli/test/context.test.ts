import { spawn } from "node:child_process"
import { mkdtemp, open, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { PlanningState, TechnicalDesign, Workspace } from "@specta/core"
import { createWorkspaceRepository } from "@specta/core/config"
import { nodeFileSystem } from "@specta/core/filesystem"
import {
  createAnalysisGraphRepository,
  createContextEngine,
  createPlanningGraphRepository,
  createTechnicalDesignGraphRepository,
  createValidationReportRepository,
  createWorkflowStateRepository,
} from "@specta/graph"
import { afterEach, expect, it } from "vitest"

const cliSourcePath = join(dirname(fileURLToPath(import.meta.url)), "../src/index.ts")
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

it("prints structured Epic implementation context from the CLI", async () => {
  const workspace = await createCliWorkspace()

  const result = await runCli(workspace.rootPath, ["context", "epic_cli_context", "--max-tokens", "4000", "--json"])
  const packet = JSON.parse(result.stdout) as { epicId: string, technicalDesign: { id: string }, tokenUsage: { budget: number } }

  expect(result.stderr).toBe("")
  expect(packet).toMatchObject({
    epicId: "epic_cli_context",
    technicalDesign: { id: "design_cli_context" },
    tokenUsage: { budget: 4000 },
  })
}, 15_000)

it("resumes persisted run context without recompiling workspace analysis", async () => {
  const workspace = await createCliWorkspace()
  await createWorkflowStateRepository().saveImplementationCheckpoint(workspace, {
    runId: "run_cli_context",
    run: {
      workflow: "implement",
      targetId: "epic_cli_context",
      targetKind: "epic",
      status: "prepared",
      phase: "context",
      revision: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    state: {
      epicId: "epic_cli_context" as TechnicalDesign["targetId"],
      status: "ready",
      activeRunId: "run_cli_context",
      revision: 0,
    },
  })
  const packet = await createContextEngine().compile(workspace, {
    epicId: "epic_cli_context",
    implementationRunId: "run_cli_context",
    workflow: "implement",
  })
  await expect(createAnalysisGraphRepository().load(workspace)).resolves.toBeNull()

  const result = await runCli(workspace.rootPath, [
    "context", "epic_cli_context", "--run", "run_cli_context", "--json",
  ])

  expect(JSON.parse(result.stdout)).toEqual(packet)
  await expect(createAnalysisGraphRepository().load(workspace)).resolves.toBeNull()
}, 15_000)

it("runs independent Epic validation and persists a failed report", async () => {
  const workspace = await createCliWorkspace()
  const result = await runCliResult(workspace.rootPath, ["validate", "epic_cli_context", "--json"])
  const report = JSON.parse(result.stdout) as { id: string, epicId: string, status: string }

  expect(result.code).toBe(1)
  expect(result.stderr).toBe("")
  expect(report).toMatchObject({ epicId: "epic_cli_context", status: "failed" })
  await expect(createValidationReportRepository().get(workspace, report.id))
    .resolves.toMatchObject(report)
}, 15_000)

it("prepares and finalizes an agent implementation run with token accounting", async () => {
  const workspace = await createCliWorkspace()
  const preparationResult = await runCli(workspace.rootPath, ["implement", "next", "--prepare", "--json"])
  const preparation = JSON.parse(preparationResult.stdout) as { runId: string, context: { epicId: string } }
  expect(preparation.context.epicId).toBe("epic_cli_context")

  await nodeFileSystem.writeText(join(workspace.rootPath, "evidence.json"), JSON.stringify({
    epicId: "epic_cli_context",
    criteria: [{ criterionId: "criterion_cli_context", tests: [{ path: "src/context.test.ts" }] }],
  }))
  await nodeFileSystem.writeText(join(workspace.rootPath, "tokens.json"), JSON.stringify({
    source: "measured",
    inputTokens: 800,
    cachedInputTokens: 200,
    outputTokens: 200,
    reasoningTokens: 50,
    totalTokens: 1000,
  }))
  const finalizationResult = await runCliResult(workspace.rootPath, [
    "implement", preparation.runId, "--finalize",
    "--evidence", "evidence.json",
    "--token-usage", "tokens.json",
    "--json",
  ])
  const finalization = JSON.parse(finalizationResult.stdout) as {
    report: { status: string }
    tokenUsage: { codingAgent: { totalTokens: number }, context: { estimatedTokens: number } }
  }
  expect(finalizationResult.code).toBe(1)
  expect(finalization.report.status).toBe("failed")
  expect(finalization.tokenUsage.codingAgent.totalTokens).toBe(1000)
  expect(finalization.tokenUsage.context.estimatedTokens).toBeGreaterThan(0)
}, 20_000)

it("passes CLI validation with directly executed acceptance evidence", async () => {
  const workspace = await createPassingCliWorkspace()

  const result = await runCliResult(workspace.rootPath, [
    "validate", "epic_cli_context", "--evidence", "evidence.json", "--json",
  ])
  const report = JSON.parse(result.stdout) as {
    status: string
    checks: Array<{ status: string, severity: string, message: string }>
    commands: Array<{ command: { testPaths?: string[] } }>
  }

  expect(report.checks.filter((check) => check.status !== "passed" && check.severity === "error")).toEqual([])
  expect(report.status).toBe("passed")
  expect(result).toMatchObject({ code: 0, stderr: "" })
  expect(report.commands).toContainEqual(expect.objectContaining({
    command: expect.objectContaining({ testPaths: ["src/context.test.ts"] }),
  }))
}, 20_000)

it("completes the real implementation workflow when agent telemetry is unavailable", async () => {
  const workspace = await createPassingCliWorkspace()
  const prepared = JSON.parse((await runCli(workspace.rootPath, [
    "implement", "next", "--prepare", "--json",
  ])).stdout) as { runId: string }
  const result = await runCliResult(workspace.rootPath, [
    "implement", prepared.runId, "--finalize", "--evidence", "evidence.json", "--json",
  ])
  const finalization = JSON.parse(result.stdout) as {
    state: { status: string }
    report: { status: string }
    implementationLinks: unknown[]
    tokenUsage: { codingAgent: { source: string }, context: { estimatedTokens: number } }
  }
  expect(result).toMatchObject({ code: 0, stderr: "" })
  expect(finalization.state.status).toBe("complete")
  expect(finalization.report.status).toBe("passed")
  expect(finalization.implementationLinks.length).toBeGreaterThan(0)
  expect(finalization.tokenUsage.codingAgent.source).toBe("unavailable")
  expect(finalization.tokenUsage.context.estimatedTokens).toBeGreaterThan(0)
}, 25_000)

async function createPassingCliWorkspace(): Promise<Workspace> {
  const workspace = await createCliWorkspace()
  workspace.packageManager = "npm"
  await createWorkspaceRepository(nodeFileSystem).save(workspace)
  await nodeFileSystem.writeText(join(workspace.rootPath, "package.json"), JSON.stringify({
    name: "context-app",
    type: "module",
    scripts: { test: "node --test src/context.test.ts" },
  }))
  await nodeFileSystem.writeText(
    join(workspace.rootPath, "src/context.ts"),
    "export interface ContextEngine { compile(): string }\n",
  )
  await nodeFileSystem.writeText(
    join(workspace.rootPath, "src/context.test.ts"),
    "import test from 'node:test'\nimport assert from 'node:assert/strict'\ntest('compiles required context', () => assert.equal(1, 1))\n",
  )
  const latest = designFixture(workspace)
  await createTechnicalDesignGraphRepository().save(workspace, {
    ...latest,
    id: "design_cli_validation" as TechnicalDesign["id"],
    revision: 2,
    summary: "Validated context compiler API.",
    modules: [{ ...latest.modules[0]!, purpose: "Context Engine" }],
  })
  await nodeFileSystem.writeText(join(workspace.rootPath, "evidence.json"), JSON.stringify({
    epicId: "epic_cli_context",
    criteria: [{
      criterionId: "criterion_cli_context",
      tests: [{ path: "src/context.test.ts", name: "compiles required context" }],
    }],
  }))
  return workspace
}

async function createCliWorkspace(): Promise<Workspace> {
  const rootPath = await mkdtemp(join(tmpdir(), "specta-cli-context-"))
  temporaryDirectories.push(rootPath)
  await nodeFileSystem.writeText(join(rootPath, "package.json"), JSON.stringify({ name: "context-app", type: "module" }))
  const workspace: Workspace = {
    schemaVersion: 1,
    id: ("ws_cli_context_" + temporaryDirectories.length) as Workspace["id"],
    rootPath,
    createdAt: "2026-01-01T00:00:00.000Z",
    packageManager: "pnpm",
    projects: [{
      id: ("project_cli_context_" + temporaryDirectories.length) as Workspace["projects"][number]["id"],
      name: "app",
      rootPath: ".",
      kind: "application",
      manifestPath: "package.json",
    }],
    artifacts: {},
    workflow: { skillTargets: [], manifestPath: ".specta/workflows/manifest.json" },
  }
  await createWorkspaceRepository(nodeFileSystem).save(workspace)
  await createPlanningGraphRepository().savePlanningState(workspace, planningFixture())
  await createTechnicalDesignGraphRepository().save(workspace, designFixture(workspace))
  return workspace
}

function planningFixture(): PlanningState {
  return {
    brief: "Build context.",
    completedStages: ["foundation", "architecture", "roadmap", "epics"],
    vision: { id: "vision", title: "Context", problem: "Agents lack context.", audience: "Developers.", outcome: "Minimal context." },
    constitution: { id: "constitution", principles: ["Remain deterministic."] },
    architecture: { id: "architecture", overview: "A graph-backed system.", components: ["Context Engine"] },
    roadmap: { id: "roadmap", milestones: [{ title: "Context", objective: "Compile context.", outcomes: ["Context is available."] }] },
    epics: [{
      id: "epic_cli_context",
      title: "Context Engine",
      goal: "Compile minimal context.",
      roadmapMilestone: "Context",
      stories: [{
        id: "story_cli_context",
        title: "Compile context",
        description: "An agent receives context.",
        acceptanceCriteria: [{ id: "criterion_cli_context", description: "Required specifications are included." }],
        tasks: [{ id: "task_cli_context", title: "Compile packet", description: "Compile a deterministic packet." }],
      }],
    }],
    relationships: [
      { type: "DEPENDS_ON", sourceId: "architecture", targetId: "vision" },
      { type: "DEPENDS_ON", sourceId: "architecture", targetId: "constitution" },
      { type: "DEPENDS_ON", sourceId: "roadmap", targetId: "architecture" },
      { type: "DEPENDS_ON", sourceId: "epic_cli_context", targetId: "roadmap" },
      { type: "IMPLEMENTS", sourceId: "epic_cli_context", targetId: "architecture" },
      { type: "CONTAINS", sourceId: "epic_cli_context", targetId: "story_cli_context" },
      { type: "CONTAINS", sourceId: "story_cli_context", targetId: "criterion_cli_context" },
      { type: "CONTAINS", sourceId: "story_cli_context", targetId: "task_cli_context" },
    ],
  } as PlanningState
}

function designFixture(workspace: Workspace): TechnicalDesign {
  return {
    id: "design_cli_context" as TechnicalDesign["id"],
    targetId: "epic_cli_context" as TechnicalDesign["targetId"],
    status: "scaffolded",
    revision: 1,
    summary: "Context compiler public API.",
    target: { kind: "existing", projectId: workspace.projects[0]!.id },
    profile: {
      projectId: workspace.projects[0]!.id,
      name: "app",
      rootPath: ".",
      state: "blank",
      language: "typescript",
      framework: "none",
      toolchain: "pnpm",
      packageManager: "pnpm",
      sourceRoots: ["src"],
      evidence: [],
      source: "technical-design",
    },
    modules: [{
      name: "Context",
      path: "src/context",
      purpose: "Compile context.",
      files: [{
        path: "src/context.ts",
        kind: "source",
        language: "typescript",
        ownership: "epic",
        exports: [{ name: "ContextEngine", kind: "interface", purpose: "Compile packets." }],
      }],
    }],
    dependencies: [],
    impactRequests: [],
  }
}

async function runCli(cwd: string, arguments_: string[]): Promise<{ stdout: string, stderr: string }> {
  const result = await runCliResult(cwd, arguments_)
  if (result.code !== 0) throw new Error(result.stderr || result.stdout)
  return result
}

async function runCliResult(
  cwd: string,
  arguments_: string[],
): Promise<{ code: number, stdout: string, stderr: string }> {
  const stdoutPath = join(cwd, ".context-stdout")
  const stderrPath = join(cwd, ".context-stderr")
  const stdoutFile = await open(stdoutPath, "w")
  const stderrFile = await open(stderrPath, "w")
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", cliSourcePath, ...arguments_], {
      cwd,
      stdio: ["ignore", stdoutFile.fd, stderrFile.fd],
    })
    child.on("error", reject)
    child.on("close", (exitCode) => resolve(exitCode ?? 1))
  })
  await stdoutFile.close()
  await stderrFile.close()
  const stdout = await readFile(stdoutPath, "utf8")
  const stderr = await readFile(stderrPath, "utf8")
  return { code, stdout, stderr }
}
