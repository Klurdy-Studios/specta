import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { createWorkspaceInitializer } from "../src/index.js"

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures")
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function useFixture(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "specta-workspace-"))
  temporaryDirectories.push(directory)
  await cp(join(fixtureRoot, name), directory, { recursive: true })
  return directory
}

describe("workspace discovery", () => {
  it("initializes a single existing repository and preserves the manifest on a repeat run", async () => {
    const rootPath = await useFixture("single-repository")
    const initializer = createWorkspaceInitializer()

    const first = await initializer.initialize({ rootPath })
    const manifestBeforeRepeat = await readFile(join(rootPath, ".specta", "workspace.json"), "utf8")
    const agentsBeforeRepeat = await readFile(join(rootPath, "AGENTS.md"), "utf8")
    const second = await initializer.initialize({ rootPath })
    const persisted = JSON.parse(await readFile(join(rootPath, ".specta", "workspace.json"), "utf8"))

    expect(first.created).toBe(true)
    expect(first.workspace.packageManager).toBe("npm")
    expect(first.workspace.projects).toMatchObject([{ name: "single-repository", rootPath: "." }])
    expect(second).toEqual({ workspace: first.workspace, created: false })
    expect(persisted).toEqual(first.workspace)
    expect(JSON.parse(await readFile(join(rootPath, "package.json"), "utf8"))).toEqual({ name: "single-repository" })
    expect(first.workspace.workflow.skillTargets).toEqual([])
    await expect(readFile(join(rootPath, ".specta", "workflows", "prompts", "plan-foundation.md"), "utf8"))
      .resolves.toContain("## Constitution")
    await expect(readFile(join(rootPath, "AGENTS.md"), "utf8"))
      .resolves.toContain("Selected native Skill targets: none.")
    expect(await readFile(join(rootPath, ".specta", "workspace.json"), "utf8")).toBe(manifestBeforeRepeat)
    expect(await readFile(join(rootPath, "AGENTS.md"), "utf8")).toBe(agentsBeforeRepeat)
  })

  it("discovers pnpm workspace packages and applications", async () => {
    const rootPath = await useFixture("pnpm-workspace")
    const result = await createWorkspaceInitializer().initialize({ rootPath })

    expect(result.workspace.packageManager).toBe("pnpm")
    expect(result.workspace.projects.map((project) => project.rootPath)).toEqual(["apps/web", "packages/core"])
    expect(result.workspace.projects.map((project) => project.kind)).toEqual(["application", "package"])
  })

  it.each(["npm-workspace", "yarn-workspace"])("discovers %s workspace packages", async (fixture) => {
    const rootPath = await useFixture(fixture)
    const result = await createWorkspaceInitializer().initialize({ rootPath })

    expect(result.workspace.projects.map((project) => project.name)).toEqual(["@example/library"])
  })

  it("supports nested patterns and exclusions without traversing ignored build directories", async () => {
    const rootPath = await useFixture("advanced-pnpm-workspace")
    const result = await createWorkspaceInitializer().initialize({ rootPath })

    expect(result.workspace.projects.map((project) => project.name)).toEqual(["@example/kept"])
  })

  it("rejects invalid package manifests and empty workspace patterns", async () => {
    await expect(createWorkspaceInitializer().initialize({ rootPath: await useFixture("invalid-package-json") }))
      .rejects.toThrow("not valid JSON")
    await expect(createWorkspaceInitializer().initialize({ rootPath: await useFixture("empty-workspace") }))
      .rejects.toThrow("No projects match")
  })

  it("reports an actionable error when the workspace root does not exist", async () => {
    const rootPath = join(await useFixture("single-repository"), "does-not-exist")
    await expect(createWorkspaceInitializer().initialize({ rootPath }))
      .rejects.toThrow("Unable to discover a workspace")
  })

  it("rejects malformed workspace configuration and updates a relocated workspace root", async () => {
    await expect(createWorkspaceInitializer().initialize({ rootPath: await useFixture("invalid-config") }))
      .rejects.toThrow("Unable to read Specta configuration")

    const originalPath = await useFixture("single-repository")
    const original = await createWorkspaceInitializer().initialize({ rootPath: originalPath })
    const relocatedPath = await mkdtemp(join(tmpdir(), "specta-relocated-"))
    temporaryDirectories.push(relocatedPath)
    await cp(originalPath, relocatedPath, { recursive: true })

    const relocated = await createWorkspaceInitializer().initialize({ rootPath: relocatedPath })
    expect(relocated.created).toBe(false)
    expect(relocated.workspace.id).toBe(original.workspace.id)
    expect(relocated.workspace.rootPath).toBe(relocatedPath)
  })

  it("configures selected Agent Integrations and preserves developer guidance", async () => {
    const rootPath = await useFixture("single-repository")
    await writeFile(join(rootPath, "AGENTS.md"), "# Team Guidance\n\nUse small patches.\n", "utf8")

    const initialized = await createWorkspaceInitializer().initialize({
      rootPath,
      skillTargets: ["codex", "cursor"],
    })
    const agents = await readFile(join(rootPath, "AGENTS.md"), "utf8")

    expect(initialized.workspace.workflow.skillTargets).toEqual(["codex", "cursor"])
    expect(agents).toContain("# Team Guidance")
    expect(agents).toContain("Selected native Skill targets: codex, cursor.")
    await expect(readFile(join(rootPath, ".specta", "skills", "codex", "specta-plan", "SKILL.md"), "utf8"))
      .resolves.toContain("Workflow: plan")
    await expect(readFile(join(rootPath, ".codex", "skills", "specta-plan", "SKILL.md"), "utf8"))
      .resolves.toContain("Workflow: plan")
    await expect(readFile(join(rootPath, ".specta", "runtime.json"), "utf8"))
      .resolves.toContain("cliCommand")
    await expect(readFile(join(rootPath, ".specta", "skills", "codex", "specta-plan-foundation", "SKILL.md"), "utf8"))
      .resolves.toContain("Workflow: `plan-foundation`")
    await expect(readFile(join(rootPath, ".specta", "skills", "cursor", "specta-plan", "SKILL.md"), "utf8"))
      .resolves.toContain("Workflow: plan")
    await expect(readFile(join(rootPath, ".cursor", "skills", "specta-plan", "SKILL.md"), "utf8"))
      .resolves.toBe(await readFile(join(rootPath, ".codex", "skills", "specta-plan", "SKILL.md"), "utf8"))
    await writeFile(join(rootPath, ".specta", "workflows", "prompts", "plan.md"), "# Team plan workflow\n", "utf8")
    await createWorkspaceInitializer().initialize({ rootPath, skillTargets: ["codex", "cursor"] })
    await expect(readFile(join(rootPath, ".specta", "workflows", "prompts", "plan.md"), "utf8"))
      .resolves.toBe("# Team plan workflow\n")

    await expect(createWorkspaceInitializer().initialize({
      rootPath,
      skillTargets: ["../not-supported" as never],
    })).rejects.toThrow("Invalid Skill target")
  })

  it("rejects unsafe workflow manifest configuration", async () => {
    const rootPath = await useFixture("single-repository")
    await createWorkspaceInitializer().initialize({ rootPath })
    const manifestPath = join(rootPath, ".specta", "workspace.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    manifest.workflow.manifestPath = ".specta/workflows/../../AGENTS.md"
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8")

    await expect(createWorkspaceInitializer().initialize({ rootPath }))
      .rejects.toThrow("invalid workflow configuration")
  })
})
