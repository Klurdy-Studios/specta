import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Workspace } from "@specta/core"
import { afterEach, describe, expect, it } from "vitest"
import { createAnalysisGraphRepository, createWorkspaceAnalyzer } from "../src/analysis/index.ts"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("workspace analyzer", () => {
  it("discovers, resolves, projects and persists a deterministic full snapshot", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "specta-analysis-"))
    temporaryDirectories.push(rootPath)
    await mkdir(join(rootPath, ".spec"), { recursive: true })
    await mkdir(join(rootPath, "src"), { recursive: true })
    await writeFile(join(rootPath, ".spec", "epic.md"), "# Analysis\n## Requirements\n- Compile source files.\n")
    await writeFile(join(rootPath, "src", "helper.ts"), 'export const helper = 1\ntest("helper", () => helper)\n')
    await writeFile(join(rootPath, "src", "index.ts"), 'import { helper } from "./helper.js"\nimport { z } from "zod"\nexport const value = helper + z.string().parse("1")\n')
    const workspace: Workspace = {
      schemaVersion: 1,
      id: "ws_analysis" as Workspace["id"],
      rootPath,
      createdAt: "2026-01-01T00:00:00.000Z",
      packageManager: "pnpm",
      projects: [{ id: "prj_analysis" as Workspace["projects"][number]["id"], name: "app", rootPath: ".", kind: "application", manifestPath: "package.json" }],
      artifacts: {},
      workflow: { skillTargets: [], manifestPath: ".specta/workflows/manifest.json" },
    }

    const analyzer = createWorkspaceAnalyzer()
    const first = await analyzer.compile(workspace)
    const firstContent = await readFile(join(rootPath, ".specta", "graph", "analysis.json"), "utf8")
    const second = await analyzer.compile(workspace)
    const secondContent = await readFile(join(rootPath, ".specta", "graph", "analysis.json"), "utf8")

    expect(second).toEqual(first)
    expect(secondContent).toBe(firstContent)
    expect(first.nodes.some((node) => node.type === "REQUIREMENT" && node.name === "Compile source files.")).toBe(true)
    expect(first.nodes.some((node) => node.type === "EXTERNAL_DEPENDENCY" && node.name === "zod")).toBe(true)
    expect(first.relationships.filter((relationship) => relationship.type === "IMPORTS")).toHaveLength(2)
    expect(first.relationships.filter((relationship) => relationship.type === "TESTS")).toHaveLength(1)
    expect(await createAnalysisGraphRepository().load(workspace)).toEqual(first)
  })
})
