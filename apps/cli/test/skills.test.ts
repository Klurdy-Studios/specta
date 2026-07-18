import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, expect, it } from "vitest"
import type { Workspace } from "@specta/core"
import { createSkillGenerator, isValidSkillTarget } from "@specta/core/skills"
import { createWorkflowManifestRepository } from "@specta/core/workflow"
import { implementationWorkflowModule } from "@specta/implementation"
import { planningWorkflowModule } from "@specta/planner"

const modules = [planningWorkflowModule, implementationWorkflowModule]

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
  const manifest = createWorkflowManifestRepository(modules)
  await manifest.ensure(workspace)
  await createSkillGenerator(manifest).generate(workspace, workspace.workflow.skillTargets)

  await expect(readFile(join(rootPath, ".specta", "skills", "codex", "specta-plan-foundation", "SKILL.md"), "utf8"))
    .resolves.toBe(await readFile(join(dirname(fileURLToPath(import.meta.url)), "../../../packages/planner/templates/skills/specta-plan-foundation.md"), "utf8"))
  await expect(readFile(join(rootPath, ".specta", "skills", "codex", "specta-plan-foundation", "SKILL.md"), "utf8"))
    .resolves.toContain("name: \"specta-plan-foundation\"")
  await expect(readFile(join(rootPath, ".specta", "skills", "codex", "specta-plan-foundation", "SKILL.md"), "utf8"))
    .resolves.toContain("plan foundation <brief> --draft .specta/drafts/plan-foundation.json")
  await expect(readFile(join(rootPath, ".specta", "skills", "codex", "specta-plan-foundation", "SKILL.md"), "utf8"))
    .resolves.toContain("If no non-empty brief was supplied")
  await expect(readFile(join(rootPath, ".specta", "skills", "codex", "specta-plan-foundation", "SKILL.md"), "utf8"))
    .resolves.toContain("Do not add IDs")
  await expect(readFile(join(rootPath, ".specta", "skills", "cursor", "specta-plan-architecture", "SKILL.md"), "utf8"))
    .resolves.toContain("Workflow: `plan-architecture`")
  await expect(readFile(join(rootPath, ".specta", "skills", "codex", "specta-plan-architecture", "SKILL.md"), "utf8"))
    .resolves.toContain("Do not add an ID")
  await expect(readFile(join(rootPath, ".specta", "skills", "codex", "specta-plan-architecture", "SKILL.md"), "utf8"))
    .resolves.toContain("optional architecture guidance")
  await expect(readFile(join(rootPath, ".specta", "skills", "vscode", "specta-plan-roadmap", "SKILL.md"), "utf8"))
    .resolves.toContain("name: \"specta-plan-roadmap\"")
  await expect(readFile(join(rootPath, ".specta", "skills", "codex", "specta-design", "SKILL.md"), "utf8"))
    .resolves.toContain("CLI helper arguments: design <epic-id> --draft <draft.json> [--feedback <changes>]")
})

it("accepts safe community skill targets only", () => {
  expect(isValidSkillTarget("community-agent")).toBe(true)
  expect(isValidSkillTarget("../outside")).toBe(false)
})
