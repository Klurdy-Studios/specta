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
    status: "approved",
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
  if (code !== 0) throw new Error(stderr || stdout)
  return { stdout, stderr }
}
