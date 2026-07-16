import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import type { Workspace } from "@specta/core"
import { createWorkflowManifestRepository } from "@specta/workflow"
import { createSkillGenerator, isValidSkillTarget } from "../src/index.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

it("generates native stage commands from the workflow manifest", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "specta-skills-"))
  temporaryDirectories.push(rootPath)
  const workspace: Workspace = {
    schemaVersion: 1,
    id: "ws_skills" as Workspace["id"],
    rootPath,
    createdAt: "2026-01-01T00:00:00.000Z",
    packageManager: "unknown",
    projects: [],
    artifacts: {},
    workflow: {
      skillTargets: ["codex", "cursor", "vscode"],
      manifestPath: ".specta/workflows/manifest.json",
    },
  }
  await createWorkflowManifestRepository().ensure(workspace)
  await createSkillGenerator().generate(workspace, workspace.workflow.skillTargets)

  await expect(readFile(join(rootPath, ".specta", "skills", "codex", "plan-foundation", "SKILL.md"), "utf8"))
    .resolves.toContain("CLI helper: specta plan foundation <brief>")
  await expect(readFile(join(rootPath, ".specta", "skills", "cursor", "commands", "plan-architecture.md"), "utf8"))
    .resolves.toContain("Workflow: plan-architecture")
  await expect(readFile(join(rootPath, ".specta", "skills", "vscode", "commands", "plan-roadmap.json"), "utf8"))
    .resolves.toContain("specta.plan-roadmap")
})

it("accepts safe community skill targets only", () => {
  expect(isValidSkillTarget("community-agent")).toBe(true)
  expect(isValidSkillTarget("../outside")).toBe(false)
})
