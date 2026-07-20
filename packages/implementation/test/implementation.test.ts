import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PlanningState, ProjectTarget, TechnicalFile, Workspace } from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { nodeFileSystem } from "@specta/core/filesystem"
import { createFrameworkSkillDiscovery } from "@specta/core/skills"
import { afterEach, expect, it } from "vitest"
import {
  createLanguageAdapterRegistry,
  createBootstrapPlan,
  createProjectProfileResolver,
  createTechnicalDesignWorkflow,
} from "../src/index.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

it("detects framework metadata while resolving the TypeScript language boundary", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "specta-profile-"))
  temporaryDirectories.push(rootPath)
  await nodeFileSystem.writeText(join(rootPath, "package.json"), JSON.stringify({
    name: "web",
    dependencies: { next: "15.0.0", react: "19.0.0", typescript: "5.8.0" },
    scripts: { dev: "next dev" },
  }))
  await nodeFileSystem.writeText(join(rootPath, "next.config.ts"), "export default {}\n")
  const workspace = existingWorkspace(rootPath)

  const profile = await createProjectProfileResolver().resolve(workspace, {
    kind: "existing",
    projectId: workspace.projects[0]!.id,
  })

  expect(profile.framework).toBe("nextjs")
  expect(profile.language).toBe("typescript")
  expect(profile.evidence.map((item) => item.kind)).toContain("dependency")
})

it("registers languages rather than frameworks and initially supports TypeScript only", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "specta-language-"))
  temporaryDirectories.push(rootPath)
  const workspace = existingWorkspace(rootPath)
  const pythonTarget: ProjectTarget = {
    kind: "new",
    name: "api",
    rootPath: "apps/api",
    projectKind: "service",
    framework: { language: "python", framework: "fastapi", toolchain: "uv" },
  }

  const pythonProfile = await createProjectProfileResolver().resolve(workspace, pythonTarget)
  expect(pythonProfile.language).toBe("python")
  expect(() => createLanguageAdapterRegistry().resolve("python"))
    .toThrow("No language adapter is registered for python")
  expect(() => createLanguageAdapterRegistry().resolve("nextjs"))
    .toThrow("No language adapter is registered for nextjs")
})

it("accepts TypeScript declarations and rejects business-logic bodies", () => {
  const adapter = createLanguageAdapterRegistry().resolve("typescript")
  const file: TechnicalFile = {
    path: "src/session.ts",
    kind: "source",
    language: "typescript",
    ownership: "epic",
    exports: [{ name: "SessionService", kind: "class", purpose: "Session boundary." }],
  }
  expect(adapter.validateFile(file, "export declare class SessionService {}\n").valid).toBe(true)
  const invalid = adapter.validateFile(file, "export function SessionService() { return 1 }\n")
  expect(invalid.valid).toBe(false)
  expect(invalid.issues).toContain("Function bodies are not allowed in declaration-only scaffolds.")
  const expression = adapter.validateFile(file, "export declare class SessionService {}\nconsole.log(\"unexpected\")\n")
  expect(expression.issues).toContain("Top-level executable expressions are not allowed in declaration-only scaffolds.")
})

it("finds installed framework Skills and returns a non-executed online search", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "specta-skill-discovery-"))
  temporaryDirectories.push(rootPath)
  await nodeFileSystem.writeText(
    join(rootPath, ".codex", "skills", "nextjs-helper", "SKILL.md"),
    "---\nname: nextjs-helper\ndescription: Build Next.js applications.\n---\n",
  )
  const workspace = existingWorkspace(rootPath)
  workspace.workflow.skillTargets = ["codex"]

  const result = await createFrameworkSkillDiscovery().discover(workspace, "nextjs")

  expect(result.installed).toEqual([{
    name: "nextjs-helper",
    path: ".codex/skills/nextjs-helper/SKILL.md",
  }])
  expect(result.onlineSearch).toEqual({
    executable: "npx",
    arguments: ["skills", "find", "nextjs project scaffolding"],
  })
})

it("creates blank-project bootstrap commands from the workspace root", () => {
  const profile = {
    name: "web",
    rootPath: "apps/web",
    state: "blank" as const,
    language: "typescript",
    framework: "nextjs",
    toolchain: "next",
    packageManager: "pnpm" as const,
    sourceRoots: ["app", "pages", "src"],
    evidence: [],
    source: "technical-design" as const,
  }
  const plan = createBootstrapPlan(profile, "design_web" as import("@specta/core").TechnicalDesignId)

  expect(plan?.cwd).toBe(".")
  expect(plan?.command.arguments).toContain("apps/web")
})

it("rolls back graph shards when Technical Design artifact persistence fails", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "specta-design-rollback-"))
  temporaryDirectories.push(rootPath)
  const workspace = { ...existingWorkspace(rootPath), projects: [] }
  const failingFileSystem: FileSystem = {
    ...nodeFileSystem,
    async writeText(path, content) {
      if (path.includes("/.specta/designs/")) throw new Error("Injected artifact failure.")
      await nodeFileSystem.writeText(path, content)
    },
  }
  const planning = {
    loadPlanningState: async () => ({
      architecture: { id: "architecture", overview: "TypeScript system.", components: ["API"] },
      epics: [{ id: "epic_api", title: "API", goal: "Deliver API.", roadmapMilestone: "MVP", stories: [] }],
    }) as unknown as PlanningState,
    savePlanningState: async () => {},
  }
  const workflow = createTechnicalDesignWorkflow({ fileSystem: failingFileSystem, planning })

  await expect(workflow.execute({
    workspace,
    targetId: "epic_api" as import("@specta/core").PlanningId,
    draft: {
      summary: "API declarations.",
      target: {
        kind: "new",
        name: "api",
        rootPath: "",
        projectKind: "service",
        framework: { language: "typescript", framework: "express", toolchain: "custom" },
      },
      modules: [{
        name: "API",
        path: "src/api",
        purpose: "API boundary.",
        files: [{
          path: "src/api.ts",
          kind: "source",
          language: "typescript",
          ownership: "epic",
          exports: [{ name: "Api", kind: "interface", purpose: "API contract." }],
        }],
      }],
      dependencies: [],
      impactRequests: [],
    },
  })).rejects.toThrow("Injected artifact failure")

  await expect(nodeFileSystem.exists(join(rootPath, ".specta", "graph", "technical-designs.json"))).resolves.toBe(false)
  await expect(nodeFileSystem.exists(join(rootPath, ".specta", "graph", "project-profiles.json"))).resolves.toBe(false)
})

function existingWorkspace(rootPath: string): Workspace {
  return {
    schemaVersion: 1,
    id: "ws_implementation" as Workspace["id"],
    rootPath,
    createdAt: "2026-01-01T00:00:00.000Z",
    packageManager: "pnpm",
    projects: [{
      id: "project_web" as Workspace["projects"][number]["id"],
      name: "web",
      rootPath: "",
      kind: "application",
      manifestPath: "package.json",
    }],
    artifacts: {},
    workflow: { skillTargets: [], manifestPath: ".specta/workflows/manifest.json" },
  }
}
