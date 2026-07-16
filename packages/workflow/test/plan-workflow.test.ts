import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createWorkspaceRepository, defaultWorkflowConfiguration } from "@specta/config"
import type { Workspace } from "@specta/core"
import { nodeFileSystem } from "@specta/filesystem"
import { createPlanWorkflow } from "../src/index.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

it("updates workspace planning artifact metadata after workflow execution", async () => {
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

  const result = await createPlanWorkflow().execute({ workspace, brief: "Create a reliable planning workflow." })
  const persisted = await createWorkspaceRepository(nodeFileSystem).load(rootPath)

  expect(result.artifacts.documents).toHaveLength(5)
  expect(persisted?.artifacts.planningPath).toBe(".specta/planning")
  await expect(readFile(join(rootPath, ".specta", "planning", "roadmap.md"), "utf8"))
    .resolves.toContain("# Roadmap")
})
