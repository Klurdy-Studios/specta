import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createWorkspaceRepository, defaultWorkflowConfiguration } from "@specta/config"
import type { Workspace } from "@specta/core"
import { nodeFileSystem } from "@specta/filesystem"
import { createPlanWorkflow, createWorkflowManifestRepository } from "../src/index.js"

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

  await createWorkflowManifestRepository().ensure(workspace)
  const workflow = createPlanWorkflow()
  const foundation = await workflow.execute({ workspace, stage: "foundation", brief: "Create a reliable planning workflow." })
  const architecture = await workflow.execute({ workspace: foundation.workspace, stage: "architecture" })
  const roadmap = await workflow.execute({ workspace: architecture.workspace, stage: "roadmap" })
  const result = await workflow.execute({ workspace: roadmap.workspace, stage: "epics" })
  const persisted = await createWorkspaceRepository(nodeFileSystem).load(rootPath)

  expect(foundation.artifacts.documents).toHaveLength(2)
  expect(result.artifacts.documents).toHaveLength(1)
  expect(result.state.completedStages).toEqual(["foundation", "architecture", "roadmap", "epics"])
  expect(result.plan?.epics).toHaveLength(1)
  expect(persisted?.artifacts.planningPath).toBe(".specta/planning")
  await expect(readFile(join(rootPath, ".specta", "graph", "planning-relationships.json"), "utf8"))
    .resolves.toContain("\"planning\"")
  await expect(readFile(join(rootPath, ".specta", "planning", "roadmap.md"), "utf8"))
    .resolves.toContain("# Roadmap")
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
  await createWorkflowManifestRepository().ensure(workspace)
  await expect(createPlanWorkflow().execute({ workspace, stage: "roadmap" }))
    .rejects.toThrow("requires: vision, constitution, architecture")
})

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
  const definitions = createWorkflowManifestRepository()
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
  const definitions = createWorkflowManifestRepository()
  await definitions.ensure(workspace)
  const manifestPath = join(rootPath, ".specta", "workflows", "manifest.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
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
  await expect(readFile(join(rootPath, ".specta", "workflows", "prompts", "discover.md"), "utf8"))
    .resolves.toContain("Discover project knowledge.")
})
