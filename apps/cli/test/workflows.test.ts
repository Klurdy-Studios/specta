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
  createProgressivePlanner,
} from "@specta/planner"
import {
  createWorkflowManifestRepository,
} from "@specta/core/workflow"
import { implementationWorkflowModule } from "@specta/implementation"
import { planningWorkflowModule } from "@specta/planner"

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
  const result = await submitStage(workflow, roadmap.workspace, "epics", roadmap.state)
  const persisted = await createWorkspaceRepository(nodeFileSystem).load(rootPath)

  expect(foundation.artifacts.documents).toHaveLength(2)
  expect(architecture.state.architecture?.components.length).toBeGreaterThan(0)
  expect(result.artifacts.documents).toHaveLength(architecture.state.architecture?.components.length)
  expect(result.state.completedStages).toEqual(["foundation", "architecture", "roadmap", "epics"])
  expect(result.plan?.epics).toHaveLength(roadmap.state.roadmap?.milestones.length)
  expect(persisted?.artifacts.planningPath).toBe(".specta/planning")
  await expect(readFile(join(rootPath, ".specta", "graph", "planning-relationships.json"), "utf8"))
    .resolves.toContain("\"planning\"")
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
  const graphPath = join(rootPath, ".specta", "graph", "planning-relationships.json")
  const workspacePath = join(rootPath, ".specta", "workspace.json")
  const graphBefore = await readFile(graphPath, "utf8")
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
    undefined,
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
  await expect(readFile(graphPath, "utf8")).resolves.toBe(graphBefore)
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
  await expect(createScaffoldWorkflow().execute({ workspace: planning.workspace, designId: revised.id }))
    .rejects.toThrow("must be approved")
  await createTechnicalDesignApprovalWorkflow().approve(planning.workspace, revised.id)
  await Promise.all(revised.modules.flatMap((module) => module.files).map((file) =>
    nodeFileSystem.writeText(join(rootPath, file.path), "// agent-authored scaffold\n"),
  ))
  const result = await createScaffoldWorkflow().execute({ workspace: planning.workspace, designId: revised.id })

  expect(result.createdPaths).toHaveLength(3)
  await expect(readFile(join(rootPath, result.createdPaths[1]!), "utf8"))
    .resolves.not.toContain("Not implemented")
  await expect(readFile(join(rootPath, ".specta", "graph", "technical-designs.json"), "utf8"))
    .resolves.toContain("scaffoldedPaths")
})

function draft() {
  return {
    summary: "Agent-authored technical design.",
    modules: [{ name: "Session", path: "src/session", purpose: "Session boundary.", dependencies: [], files: [
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
  const generated = await createProgressivePlanner().generate({ workspace, stage, state, ...(brief === undefined ? {} : { brief }) })
  const draft = stage === "foundation"
    ? {
        vision: {
          title: generated.vision!.title,
          problem: generated.vision!.problem,
          audience: generated.vision!.audience,
          outcome: generated.vision!.outcome,
        },
        constitution: { principles: generated.constitution!.principles },
      }
    : stage === "architecture"
      ? {
          overview: generated.architecture!.overview,
          components: generated.architecture!.components,
        }
      : generated
  if (stage === "foundation") return workflow.execute({ workspace, stage, draft, brief: brief! })
  if (stage === "architecture") return workflow.execute({ workspace, stage, draft })
  return workflow.execute({ workspace, stage, draft: generated })
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
