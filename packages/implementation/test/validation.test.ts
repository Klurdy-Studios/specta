import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PlanningState, TechnicalDesign, Workspace } from "@specta/core"
import { nodeFileSystem } from "@specta/core/filesystem"
import type { ValidationCommandRunner } from "@specta/core/validation"
import {
  createContextEngine,
  createPlanningGraphRepository,
  createTechnicalDesignGraphRepository,
  createValidationReportRepository,
  createWorkflowStateRepository,
  createWorkspaceAnalyzer,
} from "@specta/graph"
import { afterEach, describe, expect, it } from "vitest"
import {
  createImplementationValidationEngine,
  createValidationCommandRunner,
  discoverValidationCommands,
  renderValidationReport,
} from "../src/index.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("implementation validation", () => {
  it("passes verified criteria, design conformance and project commands", async () => {
    const workspace = await validationWorkspace()
    const runner = commandRunner("passed")
    const report = await createImplementationValidationEngine({ commandRunner: runner }).validate({
      workspace,
      epicId: "epic_session",
      evidence: {
        epicId: "epic_session",
        criteria: [{
          criterionId: "criterion_session",
          tests: [{ path: "src/session.test.ts", name: "starts a session" }],
        }],
      },
    })

    expect(report.status).toBe("passed")
    expect(report.commands.map((result) => result.command.kind)).toEqual(["test", "test", "check"])
    expect(report.commands[1]?.command).toMatchObject({
      testPaths: ["src/session.test.ts"],
      arguments: ["exec", "vitest", "run", "src/session.test.ts"],
    })
    expect(report.checks).toContainEqual(expect.objectContaining({
      category: "acceptance-criterion",
      status: "passed",
    }))
    expect(renderValidationReport(report)).toContain("Status: passed")
    await expect(createValidationReportRepository().get(workspace, report.id)).resolves.toEqual(report)
  })

  it("reports missing evidence and failing runtime tests", async () => {
    const workspace = await validationWorkspace()
    const report = await createImplementationValidationEngine({ commandRunner: commandRunner("failed") }).validate({
      workspace,
      epicId: "epic_session",
    })

    expect(report.status).toBe("failed")
    expect(report.checks).toContainEqual(expect.objectContaining({
      category: "acceptance-criterion",
      status: "failed",
      message: "Acceptance criterion has no test evidence.",
    }))
    expect(report.checks).toContainEqual(expect.objectContaining({ category: "command", status: "failed" }))
  })

  it("keeps structural validation non-authoritative", async () => {
    const workspace = await validationWorkspace()
    const full = await createImplementationValidationEngine({ commandRunner: commandRunner("passed") }).validate({
      workspace,
      epicId: "epic_session",
      evidence: {
        epicId: "epic_session",
        criteria: [{ criterionId: "criterion_session", tests: [{ path: "src/session.test.ts" }] }],
      },
    })
    const report = await createImplementationValidationEngine().validate({
      workspace,
      epicId: "epic_session",
      mode: "structural",
      evidence: {
        epicId: "epic_session",
        criteria: [{ criterionId: "criterion_session", tests: [{ path: "src/session.test.ts" }] }],
      },
    })

    expect(report.status).toBe("failed")
    expect(report.id).not.toBe(full.id)
    expect(report.commands).toEqual([])
    expect(report.checks).toContainEqual(expect.objectContaining({
      subject: { kind: "runtime-validation" },
      status: "skipped",
      severity: "error",
    }))
  })

  it("does not accept a passing suite that did not target the evidence test", async () => {
    const workspace = await validationWorkspace()
    const runner: ValidationCommandRunner = {
      async run(command) {
        const { testPaths: _ignored, ...untargeted } = command
        return {
          command: untargeted,
          status: "passed",
          exitCode: 0,
          timedOut: false,
          stdout: "",
          stderr: "",
        }
      },
    }
    const report = await createImplementationValidationEngine({ commandRunner: runner }).validate({
      workspace,
      epicId: "epic_session",
      evidence: {
        epicId: "epic_session",
        criteria: [{ criterionId: "criterion_session", tests: [{ path: "src/session.test.ts" }] }],
      },
    })

    expect(report.status).toBe("failed")
    expect(report.checks).toContainEqual(expect.objectContaining({
      category: "acceptance-criterion",
      message: "Evidence tests were not targeted by a successful test command.",
    }))
  })

  it("retains distinct full-suite and targeted command failures", async () => {
    const workspace = await validationWorkspace()
    const runner: ValidationCommandRunner = {
      async run(command) {
        const status = command.kind === "test" && command.testPaths === undefined ? "failed" as const : "passed" as const
        return {
          command,
          status,
          exitCode: status === "passed" ? 0 : 1,
          timedOut: false,
          stdout: "",
          stderr: status === "failed" ? "Suite failed." : "",
        }
      },
    }
    const report = await createImplementationValidationEngine({ commandRunner: runner }).validate({
      workspace,
      epicId: "epic_session",
      evidence: {
        epicId: "epic_session",
        criteria: [{ criterionId: "criterion_session", tests: [{ path: "src/session.test.ts" }] }],
      },
    })

    expect(report.status).toBe("failed")
    expect(report.checks.filter((check) => check.category === "command"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ status: "failed" }),
        expect.objectContaining({ status: "passed" }),
      ]))
  })

  it("validates an Implementation Run against its immutable persisted context", async () => {
    const workspace = await validationWorkspace()
    await createWorkflowStateRepository().saveImplementationCheckpoint(workspace, {
      runId: "run_session",
      run: {
        workflow: "implement",
        targetId: "epic_session",
        targetKind: "epic",
        status: "prepared",
        phase: "context",
        revision: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      state: { epicId: "epic_session" as TechnicalDesign["targetId"], status: "ready", activeRunId: "run_session", revision: 0 },
    })
    const packet = await createContextEngine().compile(workspace, {
      epicId: "epic_session",
      implementationRunId: "run_session",
      workflow: "implement",
    })
    const newer = designFixture(workspace)
    await createTechnicalDesignGraphRepository().save(workspace, {
      ...newer,
      id: "design_session_new" as TechnicalDesign["id"],
      revision: 2,
      summary: "A newer design that must not replace run context.",
      modules: [{
        ...newer.modules[0]!,
        files: [{ ...newer.modules[0]!.files[0]!, path: "src/missing.ts" }],
      }],
    })

    const report = await createImplementationValidationEngine({ commandRunner: commandRunner("passed") }).validate({
      workspace,
      epicId: "epic_session",
      implementationRunId: "run_session",
      evidence: {
        epicId: "epic_session",
        criteria: [{ criterionId: "criterion_session", tests: [{ path: "src/session.test.ts" }] }],
      },
    })

    expect(report.status).toBe("passed")
    expect(report.implementationRunId).toBe("run_session")
    expect(report.contextFingerprint).toBe(packet.sourceFingerprint)
  })

  it("fails an architecture component without an explicit Technical Design module mapping", async () => {
    const workspace = await validationWorkspace()
    const planning = planningFixture()
    planning.architecture!.components = ["Unmapped boundary"]
    await createPlanningGraphRepository().savePlanningState(workspace, planning)

    const report = await createImplementationValidationEngine({ commandRunner: commandRunner("passed") }).validate({
      workspace,
      epicId: "epic_session",
      evidence: {
        epicId: "epic_session",
        criteria: [{ criterionId: "criterion_session", tests: [{ path: "src/session.test.ts" }] }],
      },
    })

    expect(report.status).toBe("failed")
    expect(report.checks).toContainEqual(expect.objectContaining({
      category: "architecture",
      subject: expect.objectContaining({ name: "Unmapped boundary" }),
      message: "No Technical Design module explicitly maps to this architecture component.",
    }))
  })

  it("uses a workspace test owner for nested projects without local test scripts", async () => {
    const workspace = await validationWorkspace()
    workspace.projects.push({
      id: "project_nested" as Workspace["projects"][number]["id"],
      name: "nested",
      rootPath: "apps/nested",
      kind: "application",
      manifestPath: "apps/nested/package.json",
    })
    await nodeFileSystem.writeText(join(workspace.rootPath, "apps/nested/package.json"), JSON.stringify({ name: "nested" }))
    await nodeFileSystem.writeText(
      join(workspace.rootPath, "apps/nested/src/nested.test.mjs"),
      "import test from 'node:test'\nimport assert from 'node:assert/strict'\ntest('nested', () => assert.equal(1, 1))\n",
    )
    const profile = { ...designFixture(workspace).profile, rootPath: "apps/nested", packageManager: "npm" as const }
    const discovered = await discoverValidationCommands(
      workspace,
      profile,
      [],
      nodeFileSystem,
      [{ path: "apps/nested/src/nested.test.mjs", framework: "node" }],
    )

    expect(discovered.missingTestProjects).toEqual([])
    expect(discovered.commands[0]).toMatchObject({ executable: "pnpm", cwd: workspace.rootPath })
    expect(discovered.commands[1]).toMatchObject({
      executable: process.execPath,
      cwd: workspace.rootPath,
      testPaths: ["apps/nested/src/nested.test.mjs"],
      arguments: ["--test", "apps/nested/src/nested.test.mjs"],
    })
    await expect(createValidationCommandRunner().run(discovered.commands[1]!))
      .resolves.toMatchObject({ status: "passed" })
  })

  it("runs commands without a shell, bounds output, and terminates timeouts", async () => {
    const runner = createValidationCommandRunner()
    const output = "x".repeat(20_000)
    const passed = await runner.run({
      kind: "test",
      executable: "printf",
      arguments: [output],
      cwd: process.cwd(),
      timeoutMs: 5_000,
    })
    expect(passed.status).toBe("passed")
    expect(passed.stdout).toHaveLength(16_384)

    const processRoot = await mkdtemp(join(tmpdir(), "specta-validation-process-"))
    temporaryDirectories.push(processRoot)
    const marker = join(processRoot, "orphan-marker")
    const childScript = "setTimeout(() => require('node:fs').writeFileSync(" + JSON.stringify(marker) + ", 'orphan'), 250)"
    const parentScript = "require('node:child_process').spawn(process.execPath, ['-e', "
      + JSON.stringify(childScript) + "]); setInterval(() => {}, 1000)"
    const timedOut = await runner.run({
      kind: "test",
      executable: process.execPath,
      arguments: ["-e", parentScript],
      cwd: process.cwd(),
      timeoutMs: 20,
    })
    expect(timedOut).toMatchObject({ status: "failed", timedOut: true })
    await new Promise((resolve) => setTimeout(resolve, 350))
    await expect(nodeFileSystem.exists(marker)).resolves.toBe(false)
  })
})

async function validationWorkspace(): Promise<Workspace> {
  const rootPath = await mkdtemp(join(tmpdir(), "specta-validation-"))
  temporaryDirectories.push(rootPath)
  await nodeFileSystem.writeText(join(rootPath, "package.json"), JSON.stringify({
    name: "validation-app",
    type: "module",
    scripts: { test: "vitest run", check: "tsc --noEmit" },
  }))
  await nodeFileSystem.writeText(
    join(rootPath, "src", "session.ts"),
    "export interface SessionService { start(): string }\n",
  )
  await nodeFileSystem.writeText(
    join(rootPath, "src", "session.test.ts"),
    "import type { SessionService } from \"./session.js\"\nimport { test, expect } from \"vitest\"\ntest(\"starts a session\", () => expect(true).toBe(true))\n",
  )
  const workspace: Workspace = {
    schemaVersion: 1,
    id: ("ws_validation_" + temporaryDirectories.length) as Workspace["id"],
    rootPath,
    createdAt: "2026-01-01T00:00:00.000Z",
    packageManager: "pnpm",
    projects: [{
      id: ("project_validation_" + temporaryDirectories.length) as Workspace["projects"][number]["id"],
      name: "app",
      rootPath: ".",
      kind: "application",
      manifestPath: "package.json",
    }],
    artifacts: {},
    workflow: { skillTargets: [], manifestPath: ".specta/workflows/manifest.json" },
  }
  await createPlanningGraphRepository().savePlanningState(workspace, planningFixture())
  await createTechnicalDesignGraphRepository().save(workspace, designFixture(workspace))
  await createWorkspaceAnalyzer().compile(workspace)
  return workspace
}

function planningFixture(): PlanningState {
  return {
    brief: "Build sessions.",
    completedStages: ["foundation", "architecture", "roadmap", "epics"],
    vision: { id: "vision", title: "Sessions", problem: "No sessions.", audience: "Teams.", outcome: "Sessions work." },
    constitution: { id: "constitution", principles: ["Keep boundaries explicit."] },
    architecture: { id: "architecture", overview: "A modular system.", components: ["Session boundary"] },
    roadmap: { id: "roadmap", milestones: [{ title: "MVP", objective: "Deliver sessions.", outcomes: ["Sessions work."] }] },
    epics: [{
      id: "epic_session",
      title: "Sessions",
      goal: "Deliver sessions.",
      roadmapMilestone: "MVP",
      stories: [{
        id: "story_session",
        title: "Start session",
        description: "A caller starts a session.",
        acceptanceCriteria: [{ id: "criterion_session", description: "A session starts." }],
        tasks: [{ id: "task_session", title: "Implement sessions", description: "Implement the service." }],
      }],
    }],
    relationships: [
      { type: "DEPENDS_ON", sourceId: "architecture", targetId: "vision" },
      { type: "DEPENDS_ON", sourceId: "architecture", targetId: "constitution" },
      { type: "DEPENDS_ON", sourceId: "roadmap", targetId: "architecture" },
      { type: "DEPENDS_ON", sourceId: "epic_session", targetId: "roadmap" },
      { type: "IMPLEMENTS", sourceId: "epic_session", targetId: "architecture" },
      { type: "CONTAINS", sourceId: "epic_session", targetId: "story_session" },
      { type: "CONTAINS", sourceId: "story_session", targetId: "criterion_session" },
      { type: "CONTAINS", sourceId: "story_session", targetId: "task_session" },
    ],
  } as PlanningState
}

function designFixture(workspace: Workspace): TechnicalDesign {
  return {
    id: "design_session" as TechnicalDesign["id"],
    targetId: "epic_session" as TechnicalDesign["targetId"],
    status: "approved",
    revision: 1,
    summary: "Session service implementation.",
    target: { kind: "existing", projectId: workspace.projects[0]!.id },
    profile: {
      projectId: workspace.projects[0]!.id,
      name: "app",
      rootPath: ".",
      state: "existing",
      language: "typescript",
      framework: "none",
      toolchain: "pnpm",
      packageManager: "pnpm",
      sourceRoots: ["src"],
      evidence: [],
      source: "technical-design",
    },
    modules: [{
      name: "Sessions",
      path: "src",
      purpose: "Session boundary.",
      files: [{
        path: "src/session.ts",
        kind: "source",
        language: "typescript",
        ownership: "epic",
        exports: [{ name: "SessionService", kind: "interface", purpose: "Starts sessions." }],
      }],
    }],
    dependencies: [],
    impactRequests: [],
  }
}

function commandRunner(status: "passed" | "failed"): ValidationCommandRunner {
  return {
    async run(command) {
      return {
        command,
        status,
        exitCode: status === "passed" ? 0 : 1,
        timedOut: false,
        stdout: "",
        stderr: status === "passed" ? "" : "Command failed.",
      }
    },
  }
}
