import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PlanningState, TechnicalDesign, Workspace } from "@specta/core"
import { nodeFileSystem } from "@specta/core/filesystem"
import { afterEach, describe, expect, it } from "vitest"
import {
  createContextEngine,
  createFileGraphId,
  createPlanningGraphRepository,
  createSqliteWorkspaceGraphProvider,
  createStableGraphId,
  createSymbolGraphId,
  createTechnicalDesignGraphRepository,
  createWorkflowStateRepository,
  createWorkspaceAnalyzer,
  estimateContextTokens,
  renderContextPacket,
} from "../src/index.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("context compilation", () => {
  it("compiles all required implementation context for a blank project", async () => {
    const workspace = await fixtureWorkspace("blank")
    await seedPlanningAndDesign(workspace)

    const packet = await createContextEngine().compile(workspace, {
      epicId: "epic_session",
      workflow: "implement",
    })

    expect(packet.epic).toEqual({ id: "epic_session", title: "Sessions", goal: "Deliver traceable sessions." })
    expect(packet.stories[0]).toMatchObject({
      title: "Start session",
      acceptanceCriteria: [{ description: "A session can be started." }],
      tasks: [{ title: "Implement session service" }],
    })
    expect(packet.architecture.principles).toEqual(["Keep boundaries explicit."])
    expect(packet.technicalDesign).toMatchObject({ id: "design_session", status: "approved" })
    expect(packet.sourceFiles).toEqual([expect.objectContaining({ path: "src/session.ts", relevance: "designed" })])
    expect(packet.symbols).toEqual([expect.objectContaining({ name: "SessionService" })])
    expect(renderContextPacket(packet)).toContain("Implement only Epic `epic_session`")
  })

  it("selects linked source dependencies and tests while excluding unrelated files", async () => {
    const workspace = await fixtureWorkspace("existing")
    await seedPlanningAndDesign(workspace)
    await nodeFileSystem.writeText(join(workspace.rootPath, "src", "clock.ts"), "export const now = () => Date.now()\n")
    await nodeFileSystem.writeText(
      join(workspace.rootPath, "src", "session.ts"),
      "import { now } from \"./clock.js\"\nexport interface SessionService { start(): number }\nexport const startedAt = now\n",
    )
    await nodeFileSystem.writeText(
      join(workspace.rootPath, "src", "session.test.ts"),
      "import { startedAt } from \"./session.js\"\nimport { test, expect } from \"vitest\"\ntest(\"starts a session\", () => expect(startedAt()).toBeTypeOf(\"number\"))\n",
    )
    await nodeFileSystem.writeText(
      join(workspace.rootPath, "src", "consumer.ts"),
      "import type { SessionService } from \"./session.js\"\nexport type Consumer = { session: SessionService }\n",
    )
    await nodeFileSystem.writeText(
      join(workspace.rootPath, "src", "downstream.ts"),
      "import type { Consumer } from \"./consumer.js\"\nexport type Downstream = { consumer: Consumer }\n",
    )
    await nodeFileSystem.writeText(join(workspace.rootPath, "src", "unrelated.ts"), "export const unrelated = true\n")
    await createWorkspaceAnalyzer().compile(workspace)

    const packet = await createContextEngine().compile(workspace, {
      epicId: "epic_session",
      workflow: "implement",
    })

    expect(packet.sourceFiles.map((file) => file.path)).toContain("src/clock.ts")
    expect(packet.sourceFiles.map((file) => file.path)).toContain("src/session.test.ts")
    expect(packet.sourceFiles.map((file) => file.path)).not.toContain("src/unrelated.ts")
    expect(packet.sourceFiles.map((file) => file.path)).not.toContain("src/consumer.ts")
    expect(packet.tests.map((test) => test.name)).toContain("starts a session")
    expect(packet.dependencies).toContainEqual(expect.objectContaining({ kind: "external", label: "vitest" }))
    expect(packet.blastRadius.directConsumers).toContainEqual(expect.objectContaining({
      path: "src/consumer.ts",
      depth: 1,
      reason: "imports",
    }))
    expect(packet.blastRadius.transitiveConsumers).toContainEqual(expect.objectContaining({
      path: "src/downstream.ts",
      depth: 2,
    }))
    expect(packet.blastRadius.affectedTests).toContainEqual(expect.objectContaining({
      name: "starts a session",
      reason: "tests",
    }))

    const requiredOnly = await createContextEngine().compile(workspace, {
      epicId: "epic_session",
      workflow: "implement",
      maxTokens: 1,
    })
    const bounded = await createContextEngine().compile(workspace, {
      epicId: "epic_session",
      workflow: "implement",
      maxTokens: requiredOnly.tokenUsage.estimated + 16,
    })
    expect(bounded.tokenUsage.overBudget).toBe(false)
    expect(bounded.tokenUsage.estimated).toBe(estimateContextTokens(renderContextPacket(bounded)))
    expect(bounded.sourceFiles.map((file) => file.path)).not.toContain("src/clock.ts")
  })

  it("includes predecessor interfaces with canonical dependency graph IDs", async () => {
    const workspace = await fixtureWorkspace("blank")
    const planning = planningFixture()
    const predecessor = predecessorEpicFixture()
    planning.epics = [predecessor.epic, ...planning.epics!]
    planning.relationships.push(...predecessor.relationships, {
      type: "DEPENDS_ON",
      sourceId: "epic_session" as TechnicalDesign["targetId"],
      targetId: predecessor.epic.id,
    })
    const coreDesign = coreDesignFixture(workspace)
    const sessionDesign = designFixture(workspace)
    const dependency = {
      kind: "symbol" as const,
      targetDesignId: coreDesign.id,
      filePath: "src/core.ts",
      symbolName: "CorePort",
    }
    sessionDesign.dependencies = [dependency]
    sessionDesign.resolution = [{
      dependency,
      status: "available",
      resolvedEntityId: "src/core.ts#CorePort",
    }]
    await createPlanningGraphRepository().savePlanningState(workspace, planning)
    await createTechnicalDesignGraphRepository().saveMany(workspace, [coreDesign, sessionDesign])

    const packet = await createContextEngine().compile(workspace, {
      epicId: "epic_session",
      workflow: "implement",
    })
    const fileId = createFileGraphId(".", "src/core.ts")
    const symbolId = createSymbolGraphId(".", "src/core.ts", "CorePort")

    expect(packet.dependencies).toContainEqual(expect.objectContaining({
      kind: "symbol",
      nodeId: symbolId,
      status: "available",
    }))
    expect(packet.dependencies).toContainEqual(expect.objectContaining({
      kind: "epic",
      label: "Core",
      status: "planned",
    }))
    expect(packet.sourceFiles).toContainEqual(expect.objectContaining({ nodeId: fileId, relevance: "dependency" }))
    expect(packet.symbols).toContainEqual(expect.objectContaining({ nodeId: symbolId, name: "CorePort" }))
    expect(packet.relevantNodeIds).toContain(symbolId)

    const predecessorPacket = await createContextEngine().compile(workspace, {
      epicId: "epic_core",
      workflow: "implement",
    })
    expect(predecessorPacket.blastRadius.dependentEpics).toContainEqual(expect.objectContaining({
      nodeId: "epic_session",
      name: "Sessions",
      reason: "depends-on",
    }))
  })

  it("persists one immutable packet per Implementation Run and resumes it exactly", async () => {
    const workspace = await fixtureWorkspace("blank")
    await seedPlanningAndDesign(workspace)
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
      state: {
        epicId: "epic_session" as TechnicalDesign["targetId"],
        status: "ready",
        activeRunId: "run_session",
        revision: 0,
      },
    })
    const engine = createContextEngine()
    const request = { epicId: "epic_session", implementationRunId: "run_session", workflow: "implement" as const }
    const [original, concurrent] = await Promise.all([
      engine.compile(workspace, request),
      createContextEngine().compile(workspace, request),
    ])
    expect(concurrent).toEqual(original)
    await expect(engine.compile(workspace, {
      epicId: "epic_other",
      implementationRunId: "run_session",
      workflow: "implement",
    })).rejects.toThrow("different Epic")
    const changed = planningFixture()
    changed.architecture = { ...changed.architecture!, overview: "A changed architecture that belongs to a later run." }
    await createPlanningGraphRepository().savePlanningState(workspace, changed)

    await expect(engine.compile(workspace, request)).resolves.toEqual(original)
    const provider = createSqliteWorkspaceGraphProvider()
    const graphEvidence = await provider.withGraph(workspace, async (graph) => ({
      packets: await graph.queries.listNodes("ContextPacket"),
      neighborhood: await graph.queries.neighbors({
        nodeId: createStableGraphId("context-packet", ".", "run_session"),
        direction: "outgoing",
        edgeKinds: ["INCLUDES"],
        depth: 1,
      }),
    }))
    expect(graphEvidence.packets).toHaveLength(1)
    expect(graphEvidence.neighborhood.nodes.map((node) => node.id)).toContain("criterion_session")
  })

  it("retains required context and reports when the budget is too small", async () => {
    const workspace = await fixtureWorkspace("blank")
    await seedPlanningAndDesign(workspace)

    const packet = await createContextEngine().compile(workspace, {
      epicId: "epic_session",
      workflow: "implement",
      maxTokens: 10,
    })

    expect(packet.stories[0]?.acceptanceCriteria).toHaveLength(1)
    expect(packet.tokenUsage.overBudget).toBe(true)
    expect(packet.diagnostics).toContainEqual(expect.objectContaining({ code: "CONTEXT_BUDGET_EXCEEDED" }))
    expect(packet.tokenUsage.estimated).toBe(estimateContextTokens(renderContextPacket(packet)))
  })
})

describe("context token estimation", () => {
  it("uses a deterministic token approximation", () => {
    expect(estimateContextTokens("12345")).toBe(2)
  })
})

async function fixtureWorkspace(state: "blank" | "existing"): Promise<Workspace> {
  const rootPath = await mkdtemp(join(tmpdir(), "specta-context-"))
  temporaryDirectories.push(rootPath)
  await nodeFileSystem.writeText(join(rootPath, "package.json"), JSON.stringify({ name: "context-fixture", type: "module" }))
  return {
    schemaVersion: 1,
    id: ("ws_context_" + state) as Workspace["id"],
    rootPath,
    createdAt: "2026-01-01T00:00:00.000Z",
    packageManager: "pnpm",
    projects: [{
      id: "project_context" as Workspace["projects"][number]["id"],
      name: "app",
      rootPath: ".",
      kind: "application",
      manifestPath: "package.json",
    }],
    artifacts: {},
    workflow: { skillTargets: [], manifestPath: ".specta/workflows/manifest.json" },
  }
}

async function seedPlanningAndDesign(workspace: Workspace): Promise<void> {
  await createPlanningGraphRepository().savePlanningState(workspace, planningFixture())
  await createTechnicalDesignGraphRepository().save(workspace, designFixture(workspace))
}

function planningFixture(): PlanningState {
  return {
    brief: "Build sessions.",
    completedStages: ["foundation", "architecture", "roadmap", "epics"],
    vision: { id: "vision", title: "Sessions", problem: "Sessions are opaque.", audience: "Developers.", outcome: "Traceable sessions." },
    constitution: { id: "constitution", principles: ["Keep boundaries explicit."] },
    architecture: { id: "architecture", overview: "A modular TypeScript system.", components: ["Session boundary"], guidance: "Use public interfaces." },
    roadmap: { id: "roadmap", milestones: [{ title: "MVP", objective: "Deliver sessions.", outcomes: ["Sessions work."] }] },
    epics: [{
      id: "epic_session",
      title: "Sessions",
      goal: "Deliver traceable sessions.",
      roadmapMilestone: "MVP",
      stories: [{
        id: "story_session",
        title: "Start session",
        description: "A caller starts a session.",
        acceptanceCriteria: [{ id: "criterion_session", description: "A session can be started." }],
        tasks: [{ id: "task_session", title: "Implement session service", description: "Implement the approved interface." }],
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
    summary: "A session service boundary with linked tests.",
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
      purpose: "Session lifecycle boundary.",
      files: [{
        path: "src/session.ts",
        kind: "source",
        language: "typescript",
        ownership: "epic",
        exports: [{
          name: "SessionService",
          kind: "interface",
          signature: "interface SessionService { start(): number }",
          purpose: "Starts sessions.",
        }],
      }],
    }],
    dependencies: [],
    impactRequests: [],
  }
}

function predecessorEpicFixture(): {
  epic: NonNullable<PlanningState["epics"]>[number]
  relationships: PlanningState["relationships"]
} {
  const epic = {
    id: "epic_core" as TechnicalDesign["targetId"],
    title: "Core",
    goal: "Provide the shared core contract.",
    roadmapMilestone: "MVP",
    stories: [{
      id: "story_core" as TechnicalDesign["targetId"],
      title: "Use core",
      description: "Consumers use the core contract.",
      acceptanceCriteria: [{
        id: "criterion_core" as TechnicalDesign["targetId"],
        description: "The core contract is available.",
      }],
      tasks: [{
        id: "task_core" as TechnicalDesign["targetId"],
        title: "Define core",
        description: "Define the shared contract.",
      }],
    }],
  }
  return {
    epic,
    relationships: [
      { type: "DEPENDS_ON", sourceId: epic.id, targetId: "roadmap" as TechnicalDesign["targetId"] },
      { type: "IMPLEMENTS", sourceId: epic.id, targetId: "architecture" as TechnicalDesign["targetId"] },
      { type: "CONTAINS", sourceId: epic.id, targetId: "story_core" as TechnicalDesign["targetId"] },
      { type: "CONTAINS", sourceId: "story_core" as TechnicalDesign["targetId"], targetId: "criterion_core" as TechnicalDesign["targetId"] },
      { type: "CONTAINS", sourceId: "story_core" as TechnicalDesign["targetId"], targetId: "task_core" as TechnicalDesign["targetId"] },
    ],
  }
}

function coreDesignFixture(workspace: Workspace): TechnicalDesign {
  const design = designFixture(workspace)
  design.id = "design_core" as TechnicalDesign["id"]
  design.targetId = "epic_core" as TechnicalDesign["targetId"]
  design.summary = "Shared predecessor interfaces."
  design.modules = [{
    name: "Core",
    path: "src",
    purpose: "Shared core boundary.",
    files: [{
      path: "src/core.ts",
      kind: "source",
      language: "typescript",
      ownership: "epic",
      exports: [{
        name: "CorePort",
        kind: "interface",
        signature: "interface CorePort { execute(): void }",
        purpose: "Shared predecessor contract.",
      }],
    }],
  }]
  return design
}
