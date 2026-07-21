import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createWorkspaceRepository, defaultWorkflowConfiguration } from "@specta/core/config"
import type { Workspace } from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { nodeFileSystem } from "@specta/core/filesystem"
import {
  createScaffoldWorkflow,
  createTechnicalDesignApprovalWorkflow,
  createTechnicalDesignWorkflow,
} from "@specta/implementation"
import {
  createPlanWorkflow,
} from "@specta/planner"
import {
  createWorkflowManifestRepository,
} from "@specta/core/workflow"
import { implementationWorkflowModule } from "@specta/implementation"
import { planningWorkflowModule } from "@specta/planner"
import {
  createPlanningGraphRepository,
  createProjectProfileRepository,
  createScaffoldRunRepository,
  createTechnicalDesignGraphRepository,
} from "@specta/graph"

const workflowModules = [planningWorkflowModule, implementationWorkflowModule]
const workflowManifest = () => createWorkflowManifestRepository(workflowModules)

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

it("progressively updates workspace planning artifacts and graph state", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "specta-plan-workflow-"))
  temporaryDirectories.push(rootPath)
  const workspace: Workspace = {
    schemaVersion: 1,
    id: "ws_test" as Workspace["id"],
    rootPath,
    createdAt: "2026-01-01T00:00:00.000Z",
    packageManager: "unknown",
    projects: [],
    artifacts: {},
    workflow: defaultWorkflowConfiguration(),
  }

  await workflowManifest().ensure(workspace)
  const workflow = createPlanWorkflow()
  const foundation = await submitStage(workflow, workspace, "foundation", null, "Create a reliable planning workflow.")
  const architecture = await submitStage(workflow, foundation.workspace, "architecture", foundation.state)
  await expect(workflow.execute({
    workspace: architecture.workspace,
    stage: "roadmap",
    draft: JSON.parse(JSON.stringify(architecture.state)),
  })).rejects.toThrow("Invalid Roadmap draft")
  const roadmap = await submitStage(workflow, architecture.workspace, "roadmap", architecture.state)
  await expect(workflow.execute({
    workspace: roadmap.workspace,
    stage: "roadmap",
    draft: { milestones: roadmap.state.roadmap!.milestones },
  })).rejects.toThrow("already complete")
  await expect(workflow.execute({
    workspace: roadmap.workspace,
    stage: "epics",
    draft: JSON.parse(JSON.stringify(roadmap.state)),
  })).rejects.toThrow("Invalid Epics draft")
  const result = await submitStage(workflow, roadmap.workspace, "epics", roadmap.state)
  await expect(workflow.execute({
    workspace: result.workspace,
    stage: "epics",
    draft: { epics: [] },
  })).rejects.toThrow("already complete")
  const persisted = await createWorkspaceRepository(nodeFileSystem).load(rootPath)

  expect(foundation.artifacts.documents).toHaveLength(2)
  expect(architecture.state.architecture?.components.length).toBeGreaterThan(0)
  expect(result.artifacts.documents).toHaveLength(architecture.state.architecture?.components.length)
  expect(result.state.completedStages).toEqual(["foundation", "architecture", "roadmap", "epics"])
  expect(result.plan?.epics).toHaveLength(roadmap.state.roadmap?.milestones.length)
  expect(persisted?.artifacts.planningPath).toBe(".specta/planning")
  await expect(createPlanningGraphRepository().loadPlanningState(result.workspace)).resolves.toEqual(result.state)
  await expect(readFile(join(rootPath, ".specta", "planning", "roadmap.md"), "utf8"))
    .resolves.toContain("# Roadmap")
})

it("accepts agent-authored Foundation content and renders Vision and Constitution", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "specta-foundation-workflow-"))
  temporaryDirectories.push(rootPath)
  const workspace: Workspace = {
    schemaVersion: 1,
    id: "ws_foundation" as Workspace["id"],
    rootPath,
    createdAt: "2026-01-01T00:00:00.000Z",
    packageManager: "unknown",
    projects: [],
    artifacts: {},
    workflow: defaultWorkflowConfiguration(),
  }
  await workflowManifest().ensure(workspace)

  const result = await createPlanWorkflow().execute({
    workspace,
    stage: "foundation",
    brief: "Build a task tracker for small product teams.",
    draft: {
      vision: {
        title: "Task Atlas",
        problem: "Small teams lose track of project work and ownership.",
        audience: "Small product teams.",
        outcome: "Teams can plan and complete traceable work.",
      },
      constitution: {
        principles: ["Keep work traceable from intent to completion.", "Prefer simple team workflows."],
      },
    },
  })

  expect(result.state.completedStages).toEqual(["foundation"])
  expect(result.state.vision?.id).toMatch(/^plan_/)
  await expect(readFile(join(rootPath, ".specta", "planning", "vision.md"), "utf8"))
    .resolves.toContain("## Task Atlas")
  await expect(readFile(join(rootPath, ".specta", "planning", "constitution.md"), "utf8"))
    .resolves.toContain("Keep work traceable from intent to completion.")
})

it("does not allow downstream stages before their required planning artifacts", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "specta-plan-prerequisite-"))
  temporaryDirectories.push(rootPath)
  const workspace: Workspace = {
    schemaVersion: 1,
    id: "ws_prerequisite" as Workspace["id"],
    rootPath,
    createdAt: "2026-01-01T00:00:00.000Z",
    packageManager: "unknown",
    projects: [],
    artifacts: {},
    workflow: defaultWorkflowConfiguration(),
  }
  await workflowManifest().ensure(workspace)
  await expect(createPlanWorkflow().execute({ workspace, stage: "roadmap" }))
    .rejects.toThrow("requires: vision, constitution, architecture")
  await expect(createPlanWorkflow().execute({ workspace, stage: "epics" }))
    .rejects.toThrow("requires: vision, constitution, architecture, roadmap")
})

it("rolls back planning artifacts and graph state when a stage commit fails", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "specta-plan-rollback-"))
  temporaryDirectories.push(rootPath)
  const workspace: Workspace = {
    schemaVersion: 1,
    id: "ws_rollback" as Workspace["id"],
    rootPath,
    createdAt: "2026-01-01T00:00:00.000Z",
    packageManager: "unknown",
    projects: [],
    artifacts: {},
    workflow: defaultWorkflowConfiguration(),
  }
  const definitions = workflowManifest()
  await definitions.ensure(workspace)
  const foundation = await createPlanWorkflow().execute({
    workspace,
    stage: "foundation",
    brief: "Build a rollback test.",
    draft: {
      vision: { title: "Rollback", problem: "Partial writes corrupt state.", audience: "Developers", outcome: "Stage commits are atomic." },
      constitution: { principles: ["Never expose partial planning state."] },
    },
  })
  const architecture = await createPlanWorkflow().execute({
    workspace: foundation.workspace,
    stage: "architecture",
    draft: {
      overview: "A transactional workflow prevents partial planning state.",
      components: ["Commit boundary — applies or rolls back a planning stage"],
    },
  })
  const workspacePath = join(rootPath, ".specta", "workspace.json")
  const graphBefore = await createPlanningGraphRepository().loadPlanningState(architecture.workspace)
  const workspaceBefore = await readFile(workspacePath, "utf8")
  let failWorkspaceWrite = true
  const failingFileSystem: FileSystem = {
    ...nodeFileSystem,
    async writeText(path, content) {
      if (failWorkspaceWrite && path.endsWith(".specta/workspace.json")) {
        failWorkspaceWrite = false
        throw new Error("Injected workspace write failure.")
      }
      await nodeFileSystem.writeText(path, content)
    },
  }
  const workflow = createPlanWorkflow(
    createWorkspaceRepository(failingFileSystem),
    definitions,
    undefined,
    undefined,
    failingFileSystem,
  )

  await expect(workflow.execute({
    workspace: architecture.workspace,
    stage: "roadmap",
    draft: {
      milestones: [{
        title: "Atomic delivery",
        objective: "Commit a planning stage without partial state.",
        outcomes: ["Failed commits restore every persisted artifact."],
      }],
    },
  })).rejects.toThrow("Injected workspace write failure")

  await expect(readFile(join(rootPath, ".specta", "planning", "roadmap.md"), "utf8")).rejects.toThrow()
  await expect(createPlanningGraphRepository().loadPlanningState(architecture.workspace)).resolves.toEqual(graphBefore)
  await expect(readFile(workspacePath, "utf8")).resolves.toBe(workspaceBefore)
})

it("rolls back every Epic document when the Epics stage commit fails", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "specta-epics-rollback-"))
  temporaryDirectories.push(rootPath)
  const workspace: Workspace = {
    schemaVersion: 1,
    id: "ws_epics_rollback" as Workspace["id"],
    rootPath,
    createdAt: "2026-01-01T00:00:00.000Z",
    packageManager: "unknown",
    projects: [],
    artifacts: {},
    workflow: defaultWorkflowConfiguration(),
  }
  const definitions = workflowManifest()
  await definitions.ensure(workspace)
  const plan = createPlanWorkflow()
  const foundation = await submitStage(plan, workspace, "foundation", null, "Build atomic Epic planning.")
  const architecture = await submitStage(plan, foundation.workspace, "architecture", foundation.state)
  const roadmap = await submitStage(plan, architecture.workspace, "roadmap", architecture.state)
  const workspacePath = join(rootPath, ".specta", "workspace.json")
  const graphBefore = await createPlanningGraphRepository().loadPlanningState(roadmap.workspace)
  const workspaceBefore = await readFile(workspacePath, "utf8")
  let failWorkspaceWrite = true
  const failingFileSystem: FileSystem = {
    ...nodeFileSystem,
    async writeText(path, content) {
      if (failWorkspaceWrite && path.endsWith(".specta/workspace.json")) {
        failWorkspaceWrite = false
        throw new Error("Injected Epic workspace write failure.")
      }
      await nodeFileSystem.writeText(path, content)
    },
  }
  const workflow = createPlanWorkflow(
    createWorkspaceRepository(failingFileSystem),
    definitions,
    undefined,
    undefined,
    failingFileSystem,
  )
  const draft = {
    epics: roadmap.state.roadmap!.milestones.map((milestone) => ({
      title: milestone.title + " Epic",
      goal: milestone.objective,
      roadmapMilestone: milestone.title,
      stories: [{
        title: milestone.title + " Story",
        description: milestone.objective,
        acceptanceCriteria: milestone.outcomes,
        tasks: [{ title: milestone.title + " Task", description: "Deliver this milestone." }],
      }],
    })),
  }

  await expect(workflow.execute({ workspace: roadmap.workspace, stage: "epics", draft }))
    .rejects.toThrow("Injected Epic workspace write failure")

  await expect(readFile(join(rootPath, ".specta", "planning", "epics", "001-deliver-workspace-graph-epic.md"), "utf8"))
    .rejects.toThrow()
  await expect(createPlanningGraphRepository().loadPlanningState(roadmap.workspace)).resolves.toEqual(graphBefore)
  await expect(readFile(workspacePath, "utf8")).resolves.toBe(workspaceBefore)
})

it("requires an approved Epic technical design before creating declaration-only scaffolding", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "specta-scaffold-workflow-"))
  temporaryDirectories.push(rootPath)
  const workspace: Workspace = {
    schemaVersion: 1,
    id: "ws_scaffold" as Workspace["id"],
    rootPath,
    createdAt: "2026-01-01T00:00:00.000Z",
    packageManager: "unknown",
    projects: [],
    artifacts: {},
    workflow: defaultWorkflowConfiguration(),
  }
  await workflowManifest().ensure(workspace)
  const plan = createPlanWorkflow()
  const foundation = await submitStage(plan, workspace, "foundation", null, "Create session management.")
  const architecture = await submitStage(plan, foundation.workspace, "architecture", foundation.state)
  const roadmap = await submitStage(plan, architecture.workspace, "roadmap", architecture.state)
  const planning = await submitStage(plan, roadmap.workspace, "epics", roadmap.state)
  const design = await createTechnicalDesignWorkflow().execute({
    workspace: planning.workspace,
    targetId: planning.state.epics![0]!.id,
    draft: draft(),
  })
  const revised = await createTechnicalDesignWorkflow().execute({
    workspace: planning.workspace,
    targetId: planning.state.epics![0]!.id,
    draft: draft(),
    feedback: "Split service responsibilities before scaffolding.",
  })

  expect(revised.revision).toBe(design.revision + 1)
  expect(revised.feedback).toContain("Split service")
  await expect(createTechnicalDesignApprovalWorkflow().approve(planning.workspace, design.id))
    .rejects.toThrow("latest Technical Design revision")
  await expect(createScaffoldWorkflow().prepare({ workspace: planning.workspace, designId: revised.id }))
    .rejects.toThrow("must be approved")
  await createTechnicalDesignApprovalWorkflow().approve(planning.workspace, revised.id)
  const scaffold = createScaffoldWorkflow()
  await nodeFileSystem.writeText(join(rootPath, "src/session/index.ts"), "export type ExistingSessionMarker = true\n")
  const scaffoldPlan = await scaffold.prepare({ workspace: planning.workspace, designId: revised.id })
  await nodeFileSystem.writeText(join(rootPath, "src/session/index.ts"), "export type ExistingSessionMarker = false\n")
  await expect(scaffold.finalize({ workspace: planning.workspace, scaffoldRunId: scaffoldPlan.id }))
    .rejects.toThrow("must preserve existing file")
  await nodeFileSystem.writeText(join(rootPath, "src/session/index.ts"), "export type ExistingSessionMarker = true\n")
  const declarations: Record<string, string> = {
    "src/session/session.types.ts": "export interface SessionInput {}\n",
    "src/session/session.service.ts": "export declare abstract class SessionService { abstract execute(input: SessionInput): SessionInput }\n",
  }
  await Promise.all(revised.modules.flatMap((module) => module.files).filter((file) => file.path in declarations).map((file) =>
    nodeFileSystem.writeText(join(rootPath, file.path), declarations[file.path] as string),
  ))
  const result = await scaffold.finalize({ workspace: planning.workspace, scaffoldRunId: scaffoldPlan.id })

  expect(result.createdPaths).toHaveLength(2)
  expect(result.preservedPaths).toEqual(["src/session/index.ts"])
  await expect(readFile(join(rootPath, result.createdPaths[1]!), "utf8"))
    .resolves.not.toContain("Not implemented")
  await expect(createTechnicalDesignGraphRepository().get(planning.workspace, revised.id))
    .resolves.toMatchObject({ status: "scaffolded", scaffoldedPaths: expect.any(Array) })
  await expect(createProjectProfileRepository().list(planning.workspace))
    .resolves.toEqual([expect.objectContaining({ language: "typescript" })])
  await expect(createScaffoldRunRepository().get(planning.workspace, scaffoldPlan.id))
    .resolves.toMatchObject({ status: "finalized" })
})

function draft() {
  return {
    summary: "Agent-authored technical design.",
    target: {
      kind: "new" as const,
      name: "application",
      rootPath: "",
      projectKind: "application" as const,
      framework: { language: "typescript", framework: "none", toolchain: "none" },
    },
    modules: [{ name: "Session", path: "src/session", purpose: "Session boundary.", files: [
      { path: "src/session/session.types.ts", kind: "source" as const, exports: [{ name: "SessionInput", kind: "interface" as const, purpose: "Input." }] },
      { path: "src/session/session.service.ts", kind: "source" as const, exports: [{ name: "SessionService", kind: "class" as const, purpose: "Service.", signature: "abstract execute(input: SessionInput): SessionInput" }] },
      { path: "src/session/index.ts", kind: "source" as const, exports: [] },
    ] }], dependencies: [], impactRequests: [],
  }
}

async function submitStage(workflow: ReturnType<typeof createPlanWorkflow>, workspace: Workspace, stage: "foundation" | "architecture" | "roadmap" | "epics", state: import("@specta/core").PlanningState | null, brief?: string) {
  if (stage === "roadmap") {
    const draft = {
      milestones: state!.architecture!.components.map((component) => ({
        title: "Deliver " + component,
        objective: "Make the " + component + " capability usable.",
        outcomes: [component + " is usable and validated."],
      })),
    }
    return workflow.execute({ workspace, stage, draft })
  }
  if (stage === "epics") {
    const draft = {
      epics: state!.roadmap!.milestones.map((milestone) => ({
        title: milestone.title,
        goal: milestone.objective,
        roadmapMilestone: milestone.title,
        stories: [{
          title: "Complete " + milestone.title,
          description: milestone.objective,
          acceptanceCriteria: milestone.outcomes,
          tasks: [{ title: "Plan " + milestone.title, description: "Define the delivery work for this milestone." }],
        }],
      })),
    }
    return workflow.execute({ workspace, stage, draft })
  }
  if (stage === "foundation") {
    const projectBrief = brief ?? "Plan a software project."
    return workflow.execute({
      workspace,
      stage,
      brief: projectBrief,
      draft: {
        vision: { title: projectBrief, problem: projectBrief, audience: "Software teams.", outcome: "The project is delivered traceably." },
        constitution: { principles: ["Keep delivery traceable to approved intent."] },
      },
    })
  }
  if (stage === "architecture") {
    return workflow.execute({
      workspace,
      stage,
      draft: {
        overview: "A graph-backed workflow coordinates planning and delivery.",
        components: ["Workspace Graph", "Workflow Engine", "Planning artifacts"],
      },
    })
  }
  throw new Error("Unsupported test stage.")
}

it("rejects artifact templates outside the managed workflow directory", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "specta-template-path-"))
  temporaryDirectories.push(rootPath)
  const workspace: Workspace = {
    schemaVersion: 1,
    id: "ws_template_path" as Workspace["id"],
    rootPath,
    createdAt: "2026-01-01T00:00:00.000Z",
    packageManager: "unknown",
    projects: [],
    artifacts: {},
    workflow: defaultWorkflowConfiguration(),
  }
  const definitions = workflowManifest()
  await definitions.ensure(workspace)
  const manifestPath = join(rootPath, ".specta", "workflows", "manifest.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  manifest.workflows.find((workflow: { name: string }) => workflow.name === "plan-foundation").artifactTemplates = [
    ".specta/workflows/artifacts/../../../AGENTS.md",
  ]
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8")

  await expect(definitions.load(workspace)).rejects.toThrow("Workflow Manifest is invalid")
})

it("preserves an extended Workflow Manifest and executes the declared plan steps", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "specta-manifest-"))
  temporaryDirectories.push(rootPath)
  const workspace: Workspace = {
    schemaVersion: 1,
    id: "ws_manifest" as Workspace["id"],
    rootPath,
    createdAt: "2026-01-01T00:00:00.000Z",
    packageManager: "unknown",
    projects: [],
    artifacts: {},
    workflow: defaultWorkflowConfiguration(),
  }
  const definitions = workflowManifest()
  await definitions.ensure(workspace)
  const manifestPath = join(rootPath, ".specta", "workflows", "manifest.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  manifest.workflows.find((workflow: { name: string }) => workflow.name === "plan-architecture").parameters = []
  await writeFile(join(rootPath, ".specta", "workflows", "prompts", "plan-architecture.md"), "# Stale managed Architecture prompt\n", "utf8")
  manifest.workflows.push({
    name: "discover",
    description: "Discover project knowledge.",
    parameters: [],
    requires: [],
    produces: [],
    executionSteps: ["compile-workspace"],
    promptTemplate: ".specta/workflows/prompts/discover.md",
    artifactTemplates: [],
    completionCriteria: [],
    validationRequirements: [],
  })
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8")

  await definitions.ensure(workspace)
  const loaded = await definitions.load(workspace)

  expect(loaded.workflows.map((workflow) => workflow.name)).toContain("discover")
  expect(loaded.workflows.find((workflow) => workflow.name === "plan-architecture")?.parameters)
    .toEqual([{ name: "guidance", description: "Optional architectural constraints or preferences.", required: false }])
  await expect(readFile(join(rootPath, ".specta", "workflows", "prompts", "plan-architecture.md"), "utf8"))
    .resolves.toContain("never let it silently override the Constitution")
  await expect(readFile(join(rootPath, ".specta", "workflows", "prompts", "discover.md"), "utf8"))
    .resolves.toContain("Discover project knowledge.")
})
