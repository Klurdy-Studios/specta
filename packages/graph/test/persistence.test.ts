import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PlanningId, PlanningState, TechnicalDesign, Workspace } from "@specta/core"
import type { ValidationReport } from "@specta/core/validation"
import { afterEach, describe, expect, it } from "vitest"
import {
  createPlanningGraphRepository,
  createGraphEdgeId,
  createProjectProfileRepository,
  createScaffoldRunRepository,
  createSqliteWorkspaceGraphProvider,
  createTechnicalDesignGraphRepository,
  createValidationReportRepository,
  createWorkflowStateRepository,
  type GraphProjection,
} from "../src/index.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("SQLite Workspace Graph", () => {
  it("applies projections incrementally and rolls failed projections back", async () => {
    const workspace = await temporaryWorkspace()
    const provider = createSqliteWorkspaceGraphProvider()
    const projection: GraphProjection = {
      key: "test-projection",
      nodes: [{
        id: "vision_test",
        kind: "Vision",
        props: { title: "Test", problem: "No graph.", audience: "Teams.", outcome: "A graph." },
      }],
      edges: [],
      documents: [{ key: "test-document", value: { revision: 1 } }],
    }

    const created = await provider.withGraph(workspace, (graph) => graph.projections.apply(projection))
    const unchanged = await provider.withGraph(workspace, (graph) => graph.projections.apply(projection))
    const updated = await provider.withGraph(workspace, (graph) => graph.projections.apply({
      ...projection,
      nodes: [{ ...projection.nodes[0]!, props: { ...projection.nodes[0]!.props, title: "Updated" } }],
    }))

    expect(created).toMatchObject({ createdNodes: 1, unchanged: 0 })
    expect(unchanged).toMatchObject({ createdNodes: 0, updatedNodes: 0, unchanged: 1 })
    expect(updated).toMatchObject({ updatedNodes: 1 })

    await provider.withGraph(workspace, (graph) => graph.projections.apply({
      key: "other-owner",
      priority: 10,
      nodes: [{ ...projection.nodes[0]!, props: { ...projection.nodes[0]!.props, title: "Other owner" } }],
      edges: [],
    }))
    const restored = await provider.withGraph(workspace, (graph) => graph.projections.apply({
      key: "other-owner",
      priority: 10,
      nodes: [],
      edges: [],
    }))
    expect(restored.updatedNodes).toBe(1)
    await provider.withGraph(workspace, async (graph) => {
      await expect(graph.queries.getNode("vision_test")).resolves.toMatchObject({ props: { title: "Updated" } })
    })

    await expect(provider.withGraph(workspace, (graph) => graph.projections.applyMany([
      {
        key: "transaction-first",
        nodes: [{
          id: "vision_transaction_first",
          kind: "Vision",
          props: { title: "First", problem: "Failure.", audience: "Teams.", outcome: "No residue." },
        }],
        edges: [],
        documents: [{ key: "rolled-back-document", value: true }],
      },
      {
        key: "failed-projection",
        nodes: [{
          id: "vision_rolled_back",
          kind: "Vision",
          props: { title: "Rollback", problem: "Failure.", audience: "Teams.", outcome: "No residue." },
        }],
        edges: [{
          id: "edge_missing",
          kind: "DEPENDS_ON",
          sourceId: "vision_rolled_back",
          targetId: "missing",
        }],
      },
    ]))).rejects.toThrow("Graph relationship endpoints must exist")

    await provider.withGraph(workspace, async (graph) => {
      await expect(graph.queries.getNode("vision_rolled_back")).resolves.toBeNull()
      await expect(graph.queries.getNode("vision_transaction_first")).resolves.toBeNull()
      await expect(graph.readDocument("rolled-back-document")).resolves.toBeNull()
    })

    const deleted = await provider.withGraph(workspace, (graph) => graph.projections.apply({
      key: projection.key,
      nodes: [],
      edges: [],
    }))
    expect(deleted.deletedNodes).toBe(1)
    await provider.withGraph(workspace, async (graph) => {
      await expect(graph.readDocument("test-document")).resolves.toBeNull()
    })

    const firstDependency = { kind: "DEPENDS_ON" as const, sourceId: "module_a", targetId: "module_b" }
    const secondDependency = { kind: "DEPENDS_ON" as const, sourceId: "module_b", targetId: "module_a" }
    await provider.withGraph(workspace, (graph) => graph.projections.apply({
      key: "cyclic-modules",
      nodes: [
        { id: "module_a", kind: "Module", props: { name: "A", path: "a", purpose: "A." } },
        { id: "module_b", kind: "Module", props: { name: "B", path: "b", purpose: "B." } },
      ],
      edges: [
        { ...firstDependency, id: createGraphEdgeId(firstDependency), sourceKind: "Module", targetKind: "Module" },
        { ...secondDependency, id: createGraphEdgeId(secondDependency), sourceKind: "Module", targetKind: "Module" },
      ],
    }))
    await provider.withGraph(workspace, async (graph) => {
      const cycle = await graph.queries.dependencies("module_a", 10)
      expect(cycle.nodes.map((node) => node.id)).toEqual(["module_a", "module_b"])
      expect(cycle.edges).toHaveLength(2)
    })
  })

  it("queries dependencies and resolves eligible Epics deterministically", async () => {
    const workspace = await temporaryWorkspace()
    const provider = createSqliteWorkspaceGraphProvider()
    const planning = planningFixture()
    await createPlanningGraphRepository(undefined, provider).savePlanningState(workspace, planning)
    const firstDesign = designFixture("design_first", "epic_first")
    const secondDesign = designFixture("design_second", "epic_second")
    secondDesign.dependencies = [{ kind: "file", targetDesignId: firstDesign.id, filePath: "src/index.ts" }]
    const designs = createTechnicalDesignGraphRepository(undefined, provider)
    await designs.saveMany(workspace, [firstDesign, secondDesign])
    const unresolved = designFixture("design_unresolved", "epic_second")
    unresolved.dependencies = [{
      kind: "technical-design",
      targetDesignId: "missing_design" as TechnicalDesign["id"],
    }]
    await expect(designs.save(workspace, unresolved)).rejects.toThrow("dependency target is missing")

    await provider.withGraph(workspace, async (graph) => {
      await expect(graph.queries.nextEligibleEpic()).resolves.toMatchObject({
        epicId: "epic_first",
        designId: "design_first",
      })
      const dependencies = await graph.queries.dependencies("epic_second")
      expect(dependencies.nodes.map((node) => node.id)).toContain("epic_first")
      const dependents = await graph.queries.dependents("epic_first")
      expect(dependents.nodes.map((node) => node.id)).toContain("epic_second")
      const searched = await graph.queries.searchNeighbors({
        nodeId: "epic_second",
        direction: "outgoing",
        edgeKinds: ["DEPENDS_ON"],
        depth: 2,
      })
      expect(searched).toContainEqual(expect.objectContaining({ id: "epic_first", depth: 1 }))
      const rootOnly = await graph.queries.neighbors({ nodeId: "epic_first", depth: 0 })
      expect(rootOnly.nodes.map((node) => node.id)).toEqual(["epic_first"])
      expect(rootOnly.edges).toEqual([])
    })
    await provider.withGraph(workspace, (graph) => graph.projections.apply({
      key: "corrupt-document-view",
      priority: 1_000,
      nodes: [],
      edges: [],
      documents: [
        { key: "planning-state", value: null },
        { key: "technical-designs", value: [] },
      ],
    }))
    await expect(provider.withGraph(workspace, (graph) => graph.queries.nextEligibleEpic()))
      .resolves.toMatchObject({ epicId: "epic_first", designId: "design_first" })
    await provider.withGraph(workspace, (graph) => graph.projections.apply({
      key: "corrupt-document-view",
      nodes: [],
      edges: [],
    }))

    await designs.save(workspace, designFixture("design_first_v2", "epic_first", "draft", 2))
    await expect(provider.withGraph(workspace, (graph) => graph.queries.nextEligibleEpic())).resolves.toBeNull()
    await designs.save(workspace, designFixture("design_first_v2", "epic_first", "approved", 2))
    await expect(provider.withGraph(workspace, (graph) => graph.queries.nextEligibleEpic()))
      .resolves.toMatchObject({ epicId: "epic_first", designId: "design_first_v2" })

    const workflow = createWorkflowStateRepository(undefined, provider)
    await workflow.saveImplementationCheckpoint(workspace, {
      runId: "run_first",
      run: workflowRun("epic_first", "complete"),
      state: { epicId: "epic_first" as PlanningId, status: "complete", revision: 1 },
      validationReport: validationReportFixture("epic_first", "run_first", "passed"),
    })
    await expect(provider.withGraph(workspace, (graph) => graph.queries.nextEligibleEpic()))
      .resolves.toMatchObject({ epicId: "epic_second", designId: "design_second" })

    await workflow.saveImplementationCheckpoint(workspace, {
      runId: "run_second",
      run: workflowRun("epic_second", "blocked"),
      state: { epicId: "epic_second" as PlanningId, status: "blocked", activeRunId: "run_second", revision: 1 },
    })
    await expect(provider.withGraph(workspace, (graph) => graph.queries.nextEligibleEpic())).resolves.toBeNull()
  })

  it("commits implementation run checkpoints and Epic state together", async () => {
    const workspace = await temporaryWorkspace()
    const provider = createSqliteWorkspaceGraphProvider()
    await createPlanningGraphRepository(undefined, provider).savePlanningState(workspace, planningFixture())
    const repository = createWorkflowStateRepository(undefined, provider)

    await repository.saveImplementationCheckpoint(workspace, {
      runId: "run_active",
      run: workflowRun("epic_first", "in-progress"),
      state: { epicId: "epic_first" as PlanningId, status: "in-progress", activeRunId: "run_active", revision: 1 },
    })

    await expect(repository.getRun(workspace, "run_active")).resolves.toMatchObject({ status: "in-progress" })
    await expect(repository.getEpicState(workspace, "epic_first")).resolves.toEqual({
      epicId: "epic_first",
      status: "in-progress",
      activeRunId: "run_active",
      revision: 1,
    })
    await provider.withGraph(workspace, async (graph) => {
      const neighborhood = await graph.queries.neighbors({ nodeId: "run_active", direction: "outgoing" })
      expect(neighborhood.edges.map((edge) => edge.kind)).toContain("TARGETS")
    })

    await repository.saveImplementationCheckpoint(workspace, {
      runId: "run_blocked",
      run: workflowRun("epic_first", "blocked"),
      state: { epicId: "epic_first" as PlanningId, status: "blocked", activeRunId: "run_blocked", revision: 2 },
    })
    await expect(repository.saveImplementationCheckpoint(workspace, {
      runId: "run_active",
      run: workflowRun("epic_first", "in-progress"),
      state: { epicId: "epic_first" as PlanningId, status: "in-progress", activeRunId: "run_active", revision: 1 },
    })).rejects.toThrow("revision cannot move backwards")
    await expect(repository.getEpicState(workspace, "epic_first")).resolves.toMatchObject({
      status: "blocked",
      revision: 2,
    })

    await expect(repository.saveImplementationCheckpoint(workspace, {
      runId: "run_invalid",
      run: workflowRun("missing_epic", "in-progress"),
      state: { epicId: "missing_epic" as PlanningId, status: "in-progress", activeRunId: "run_invalid", revision: 1 },
    })).rejects.toThrow()
    await expect(repository.getRun(workspace, "run_invalid")).resolves.toBeNull()
    await expect(repository.getEpicState(workspace, "missing_epic")).resolves.toBeNull()

    await repository.saveImplementationCheckpoint(workspace, {
      runId: "run_second_prepared",
      run: {
        ...workflowRun("epic_second", "in-progress"),
        status: "prepared",
        phase: "prepared",
      },
      state: { epicId: "epic_second" as PlanningId, status: "ready", activeRunId: "run_second_prepared", revision: 1 },
      producedNodeIds: ["architecture", "architecture"],
    })
    await provider.withGraph(workspace, async (graph) => {
      const produced = await graph.queries.neighbors({
        nodeId: "run_second_prepared",
        direction: "outgoing",
        edgeKinds: ["PRODUCES"],
      })
      expect(produced.nodes.map((node) => node.id)).toContain("architecture")
      expect(produced.edges).toHaveLength(1)
    })
    await expect(repository.saveImplementationCheckpoint(workspace, {
      runId: "run_mismatch",
      run: workflowRun("epic_second", "blocked"),
      state: { epicId: "epic_second" as PlanningId, status: "validation-failed", revision: 2 },
    })).rejects.toThrow("statuses are inconsistent")

    const competing = await Promise.allSettled([
      repository.saveImplementationCheckpoint(workspace, {
        runId: "run_second_active",
        run: workflowRun("epic_second", "in-progress"),
        state: { epicId: "epic_second" as PlanningId, status: "in-progress", activeRunId: "run_second_active", revision: 2 },
      }),
      repository.saveImplementationCheckpoint(workspace, {
        runId: "run_second_blocked",
        run: workflowRun("epic_second", "blocked"),
        state: { epicId: "epic_second" as PlanningId, status: "blocked", activeRunId: "run_second_blocked", revision: 2 },
      }),
    ])
    expect(competing.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(competing.filter((result) => result.status === "rejected")).toHaveLength(1)
  })

  it("commits validation provenance with terminal implementation state", async () => {
    const workspace = await temporaryWorkspace()
    const provider = createSqliteWorkspaceGraphProvider()
    await createPlanningGraphRepository(undefined, provider).savePlanningState(workspace, planningFixture())
    await createTechnicalDesignGraphRepository(undefined, provider)
      .save(workspace, designFixture("design_first", "epic_first"))
    const workflow = createWorkflowStateRepository(undefined, provider)
    const report = validationReportFixture("epic_first", "run_validated", "passed")

    await expect(workflow.saveImplementationCheckpoint(workspace, {
      runId: "run_without_report",
      run: workflowRun("epic_first", "complete"),
      state: { epicId: "epic_first" as PlanningId, status: "complete", revision: 1 },
    })).rejects.toThrow("require a Validation Report")

    const incompleteBase = validationReportFixture("epic_first", "run_incomplete", "passed")
    const incompleteChecks = incompleteBase.checks.filter((check) => check.subject.id !== "story_first")
    await expect(workflow.saveImplementationCheckpoint(workspace, {
      runId: "run_incomplete",
      run: workflowRun("epic_first", "complete"),
      state: { epicId: "epic_first" as PlanningId, status: "complete", revision: 1 },
      validationReport: {
        ...incompleteBase,
        checks: incompleteChecks,
        summary: { passed: incompleteChecks.length, failed: 0, skipped: 0, warnings: 0 },
      },
    })).rejects.toThrow("missing passing Story coverage")

    const wrongWorkflowReport = validationReportFixture("epic_first", "run_validate", "passed")
    await expect(workflow.saveImplementationCheckpoint(workspace, {
      runId: "run_validate",
      run: { ...workflowRun("epic_first", "complete"), workflow: "validate" },
      state: { epicId: "epic_first" as PlanningId, status: "complete", revision: 1 },
      validationReport: wrongWorkflowReport,
    })).rejects.toThrow("require an implement Workflow Run")

    await workflow.saveImplementationCheckpoint(workspace, {
      runId: "run_validated",
      run: workflowRun("epic_first", "complete"),
      state: { epicId: "epic_first" as PlanningId, status: "complete", revision: 1 },
      validationReport: report,
    })

    await expect(createValidationReportRepository(undefined, provider).get(workspace, report.id))
      .resolves.toEqual(report)
    await provider.withGraph(workspace, async (graph) => {
      const validated = await graph.queries.neighbors({
        nodeId: report.id,
        direction: "outgoing",
        edgeKinds: ["VALIDATES"],
      })
      expect(validated.nodes.map((node) => node.id)).toContain("epic_first")
      const produced = await graph.queries.neighbors({
        nodeId: "run_validated",
        direction: "outgoing",
        edgeKinds: ["PRODUCES"],
      })
      expect(produced.nodes.map((node) => node.id)).toContain(report.id)
    })

    await expect(workflow.saveImplementationCheckpoint(workspace, {
      runId: "run_misaligned",
      run: workflowRun("epic_second", "complete"),
      state: { epicId: "epic_second" as PlanningId, status: "complete", revision: 1 },
      validationReport: report,
    })).rejects.toThrow("must target the checkpoint")
    await expect(workflow.getRun(workspace, "run_misaligned")).resolves.toBeNull()
  })

  it("serializes concurrent collection updates without losing entries", async () => {
    const workspace = await temporaryWorkspace()
    const repository = createProjectProfileRepository()
    const profile = (name: string) => ({
      name,
      rootPath: "apps/" + name,
      state: "blank" as const,
      language: "typescript",
      framework: "none",
      toolchain: "pnpm",
      packageManager: "pnpm" as const,
      sourceRoots: ["src"],
      evidence: [],
      source: "technical-design" as const,
    })

    await Promise.all([
      repository.save(workspace, profile("web")),
      repository.save(workspace, profile("admin")),
    ])

    await expect(repository.list(workspace)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "web" }),
      expect.objectContaining({ name: "admin" }),
    ]))
  })

  it("imports every legacy graph shard once without rewriting source files", async () => {
    const workspace = await temporaryWorkspace()
    const graphPath = join(workspace.rootPath, ".specta", "graph")
    await mkdir(graphPath, { recursive: true })
    const planning = planningFixture()
    const design = designFixture("legacy_design", "epic_first")
    const scaffold = {
      id: "legacy_scaffold" as import("@specta/core").ScaffoldRunId,
      designId: design.id,
      designRevision: design.revision,
      status: "prepared" as const,
      profile: design.profile,
      expectedFiles: design.modules.flatMap((module) => module.files),
      existingFiles: [],
    }
    const legacyFiles = {
      "planning-relationships.json": {
        schemaVersion: 3,
        planning,
        completedStages: planning.completedStages,
        nodes: planningNodes(planning),
        relationships: planning.relationships,
      },
      "technical-designs.json": { schemaVersion: 1, designs: [design], nodes: [], relationships: [] },
      "project-profiles.json": { schemaVersion: 1, profiles: [design.profile], nodes: [] },
      "scaffold-runs.json": { schemaVersion: 1, runs: [scaffold], nodes: [] },
      "analysis.json": {
        schemaVersion: 2,
        analysis: { schemaVersion: 1, specifications: [], sourceFiles: [], diagnostics: [] },
        nodes: [],
        relationships: [],
      },
    }
    await Promise.all(Object.entries(legacyFiles).map(([name, value]) =>
      writeFile(join(graphPath, name), JSON.stringify(value, null, 2) + "\n"),
    ))
    const planningSource = await readFile(join(graphPath, "planning-relationships.json"), "utf8")

    await expect(createPlanningGraphRepository().loadPlanningState(workspace)).resolves.toEqual(planning)
    await expect(createTechnicalDesignGraphRepository().get(workspace, design.id)).resolves.toEqual(design)
    await expect(createProjectProfileRepository().list(workspace)).resolves.toEqual([design.profile])
    await expect(createScaffoldRunRepository().get(workspace, scaffold.id)).resolves.toEqual(scaffold)
    await expect(readFile(join(graphPath, "planning-relationships.json"), "utf8")).resolves.toBe(planningSource)

    await writeFile(join(graphPath, "project-profiles.json"), "not json", "utf8")
    await expect(createProjectProfileRepository().list(workspace)).resolves.toEqual([design.profile])
  })
})

async function temporaryWorkspace(): Promise<Workspace> {
  const rootPath = await mkdtemp(join(tmpdir(), "specta-sqlite-graph-"))
  temporaryDirectories.push(rootPath)
  return {
    schemaVersion: 1,
    id: "ws_graph" as Workspace["id"],
    rootPath,
    createdAt: "2026-01-01T00:00:00.000Z",
    packageManager: "pnpm",
    projects: [],
    artifacts: {},
    workflow: { skillTargets: [], manifestPath: ".specta/workflows/manifest.json" },
  }
}

function planningFixture(): PlanningState {
  const firstStory = {
    id: "story_first",
    title: "First story",
    description: "Deliver the first behavior.",
    acceptanceCriteria: [{ id: "criterion_first", description: "First behavior works." }],
    tasks: [{ id: "task_first", title: "Build first", description: "Build the first behavior." }],
  }
  const secondStory = {
    id: "story_second",
    title: "Second story",
    description: "Deliver the second behavior.",
    acceptanceCriteria: [{ id: "criterion_second", description: "Second behavior works." }],
    tasks: [{ id: "task_second", title: "Build second", description: "Build the second behavior." }],
  }
  return {
    brief: "Build two ordered capabilities.",
    completedStages: ["foundation", "architecture", "roadmap", "epics"],
    vision: { id: "vision", title: "Graph", problem: "Work is disconnected.", audience: "Teams.", outcome: "Work is connected." },
    constitution: { id: "constitution", principles: ["Keep the graph canonical."] },
    architecture: { id: "architecture", overview: "A graph-backed system.", components: ["Graph"] },
    roadmap: { id: "roadmap", milestones: [{ title: "MVP", objective: "Deliver both capabilities.", outcomes: ["Both work."] }] },
    epics: [
      { id: "epic_first", title: "First", goal: "Deliver first.", roadmapMilestone: "MVP", stories: [firstStory] },
      { id: "epic_second", title: "Second", goal: "Deliver second.", roadmapMilestone: "MVP", stories: [secondStory] },
    ],
    relationships: [
      { type: "DEPENDS_ON", sourceId: "architecture", targetId: "vision" },
      { type: "DEPENDS_ON", sourceId: "architecture", targetId: "constitution" },
      { type: "DEPENDS_ON", sourceId: "roadmap", targetId: "architecture" },
      { type: "DEPENDS_ON", sourceId: "epic_first", targetId: "roadmap" },
      { type: "IMPLEMENTS", sourceId: "epic_first", targetId: "architecture" },
      { type: "CONTAINS", sourceId: "epic_first", targetId: "story_first" },
      { type: "CONTAINS", sourceId: "story_first", targetId: "criterion_first" },
      { type: "CONTAINS", sourceId: "story_first", targetId: "task_first" },
      { type: "DEPENDS_ON", sourceId: "epic_second", targetId: "roadmap" },
      { type: "IMPLEMENTS", sourceId: "epic_second", targetId: "architecture" },
      { type: "CONTAINS", sourceId: "epic_second", targetId: "story_second" },
      { type: "CONTAINS", sourceId: "story_second", targetId: "criterion_second" },
      { type: "CONTAINS", sourceId: "story_second", targetId: "task_second" },
      { type: "DEPENDS_ON", sourceId: "epic_second", targetId: "epic_first" },
    ],
  } as PlanningState
}

function planningNodes(state: PlanningState) {
  return [
    { id: state.vision!.id, type: "VISION" },
    { id: state.constitution!.id, type: "CONSTITUTION" },
    { id: state.architecture!.id, type: "ARCHITECTURE" },
    { id: state.roadmap!.id, type: "ROADMAP" },
    ...state.epics!.flatMap((epic) => [
      { id: epic.id, type: "EPIC" },
      ...epic.stories.flatMap((story) => [
        { id: story.id, type: "STORY" },
        ...story.acceptanceCriteria.map((criterion) => ({ id: criterion.id, type: "ACCEPTANCE_CRITERION" })),
        ...story.tasks.map((task) => ({ id: task.id, type: "TASK" })),
      ]),
    ]),
  ]
}

function designFixture(
  id: string,
  targetId: string,
  status: TechnicalDesign["status"] = "approved",
  revision = 1,
): TechnicalDesign {
  return {
    id: id as TechnicalDesign["id"],
    targetId: targetId as TechnicalDesign["targetId"],
    status,
    revision,
    summary: "A declaration-only design.",
    target: {
      kind: "new",
      name: "app",
      rootPath: "",
      projectKind: "application",
      framework: { language: "typescript", framework: "none", toolchain: "pnpm" },
    },
    profile: {
      name: "app",
      rootPath: "",
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
      name: "App",
      path: "src",
      purpose: "Application boundary.",
      files: [{
        path: "src/index.ts",
        kind: "source",
        language: "typescript",
        ownership: "epic",
        exports: [{ name: "App", kind: "interface", purpose: "Application contract." }],
      }],
    }],
    dependencies: [],
    impactRequests: [],
  }
}

function validationReportFixture(
  epicId: string,
  runId: string,
  status: ValidationReport["status"],
): ValidationReport {
  const checkStatus = status === "passed" ? "passed" : "failed"
  const suffix = epicId === "epic_first" ? "first" : "second"
  const successfulChecks: ValidationReport["checks"] = [{
    id: "check_epic_" + runId,
    category: "requirement",
    subject: { kind: "epic", id: epicId },
    status: "passed",
    severity: "error",
    message: "Epic passed.",
    evidenceNodeIds: [epicId],
  }, {
    id: "check_story_" + runId,
    category: "requirement",
    subject: { kind: "story", id: "story_" + suffix },
    status: "passed",
    severity: "error",
    message: "Story passed.",
    evidenceNodeIds: ["story_" + suffix],
  }, {
    id: "check_criterion_" + runId,
    category: "acceptance-criterion",
    subject: { kind: "acceptance-criterion", id: "criterion_" + suffix },
    status: "passed",
    severity: "error",
    message: "Criterion passed.",
    evidenceNodeIds: ["criterion_" + suffix],
  }, {
    id: "check_test_" + runId,
    category: "test",
    subject: { kind: "test", id: "criterion_" + suffix },
    status: "passed",
    severity: "error",
    message: "Test passed.",
    evidenceNodeIds: ["criterion_" + suffix],
  }, {
    id: "check_architecture_" + runId,
    category: "architecture",
    subject: { kind: "architecture-component", id: "architecture", name: "Graph" },
    status: "passed",
    severity: "error",
    message: "Architecture passed.",
    evidenceNodeIds: ["architecture"],
  }, {
    id: "check_design_" + runId,
    category: "architecture",
    subject: { kind: "technical-design", id: "design_" + suffix },
    status: "passed",
    severity: "error",
    message: "Design passed.",
    evidenceNodeIds: ["design_" + suffix],
  }, {
    id: "check_file_" + runId,
    category: "file",
    subject: { kind: "source", path: "src/app.ts" },
    status: "passed",
    severity: "error",
    message: "File passed.",
    evidenceNodeIds: [],
  }]
  return {
    schemaVersion: 1,
    id: "validation_" + runId,
    epicId,
    implementationRunId: runId,
    mode: "full",
    contextFingerprint: "c".repeat(64),
    sourceFingerprint: "a".repeat(64),
    status,
    checks: status === "passed" ? successfulChecks : [{
      id: "check_" + runId,
      category: "requirement",
      subject: { kind: "epic", id: epicId },
      status: checkStatus,
      severity: "error",
      message: "Epic failed.",
      evidenceNodeIds: [epicId],
    }],
    commands: status === "passed" ? [{
      command: {
        kind: "test",
        executable: "pnpm",
        arguments: ["run", "test"],
        cwd: "/workspace",
        timeoutMs: 120_000,
      },
      status: "passed",
      exitCode: 0,
      timedOut: false,
      stdout: "",
      stderr: "",
    }] : [],
    summary: {
      passed: status === "passed" ? successfulChecks.length : 0,
      failed: status === "failed" ? 1 : 0,
      skipped: 0,
      warnings: 0,
    },
  }
}

function workflowRun(epicId: string, status: "in-progress" | "blocked" | "complete") {
  return {
    workflow: "implement",
    targetId: epicId,
    targetKind: "epic" as const,
    status,
    phase: status === "complete" ? "completed" : status,
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...(status === "complete" ? { completedAt: "2026-01-01T01:00:00.000Z" } : {}),
  }
}
