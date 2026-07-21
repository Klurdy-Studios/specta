import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Workspace } from "@specta/core"
import { afterEach, describe, expect, it } from "vitest"
import { createAnalysisGraphRepository, createWorkspaceAnalyzer, projectWorkspaceAnalysis } from "../src/analysis/index.ts"
import { createParserRegistry, markdownSpecificationParser, type LanguageParser } from "../src/parser/index.ts"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("workspace analyzer", () => {
  it("discovers, resolves, projects and persists a deterministic full snapshot", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "specta-analysis-"))
    temporaryDirectories.push(rootPath)
    await mkdir(join(rootPath, ".spec"), { recursive: true })
    await mkdir(join(rootPath, ".specta", "planning"), { recursive: true })
    await mkdir(join(rootPath, "src"), { recursive: true })
    await writeFile(join(rootPath, ".spec", "epic.md"), "# Analysis\n## Requirements\n- Compile source files.\n")
    await writeFile(join(rootPath, ".specta", "planning", "architecture.md"), "# Architecture\n")
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
    expect(first.analysis.specifications.map((specification) => specification.path)).toEqual([
      ".spec/epic.md",
      ".specta/planning/architecture.md",
    ])
    expect(first.nodes.some((node) => node.type === "SPECIFICATION_ENTITY" && node.title === "Compile source files.")).toBe(true)
    expect(first.nodes.some((node) => node.type === "EXTERNAL_DEPENDENCY" && node.name === "zod")).toBe(true)
    expect(first.relationships.filter((relationship) => relationship.type === "IMPORTS")).toHaveLength(2)
    expect(first.relationships.filter((relationship) => relationship.type === "TESTS")).toHaveLength(1)
    expect(await createAnalysisGraphRepository().load(workspace)).toEqual(first)
  })

  it("resolves Next.js aliases, workspace packages, assets, re-exports and cross-file tests", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "specta-monorepo-analysis-"))
    temporaryDirectories.push(rootPath)
    await mkdir(join(rootPath, "apps", "web", "src"), { recursive: true })
    await mkdir(join(rootPath, "packages", "ui", "src"), { recursive: true })
    await writeFile(join(rootPath, "apps", "web", "tsconfig.json"), JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } },
    }))
    await writeFile(join(rootPath, "apps", "web", "src", "helper.ts"), "export function helper() { return true }\n")
    await writeFile(join(rootPath, "apps", "web", "src", "logo.svg"), "<svg/>\n")
    await writeFile(join(rootPath, "apps", "web", "src", "index.ts"), [
      'import { it } from "vitest"',
      'import { helper as run } from "@/helper"',
      'import { button } from "@workspace/ui"',
      'import logo from "./logo.svg"',
      'it("uses dependencies", () => { run(); button(); return logo })',
    ].join("\n"))
    await writeFile(join(rootPath, "apps", "web", "src", "barrel.ts"), 'export { helper as renamed } from "@/helper"\n')
    await writeFile(join(rootPath, "packages", "ui", "src", "index.ts"), "export function button() { return true }\n")
    const workspace: Workspace = {
      schemaVersion: 1,
      id: "ws_monorepo" as Workspace["id"],
      rootPath,
      createdAt: "2026-01-01T00:00:00.000Z",
      packageManager: "pnpm",
      projects: [
        { id: "prj_web" as Workspace["projects"][number]["id"], name: "web", rootPath: "apps/web", kind: "application", manifestPath: "apps/web/package.json" },
        { id: "prj_ui" as Workspace["projects"][number]["id"], name: "@workspace/ui", rootPath: "packages/ui", kind: "package", manifestPath: "packages/ui/package.json" },
      ],
      artifacts: {},
      workflow: { skillTargets: [], manifestPath: ".specta/workflows/manifest.json" },
    }

    const snapshot = await createWorkspaceAnalyzer().compile(workspace)
    const entry = snapshot.analysis.sourceFiles.find((file) => file.path === "apps/web/src/index.ts")
    expect(entry?.imports.map((item) => item.resolution)).toEqual([
      { kind: "external", packageName: "vitest" },
      { kind: "workspace-file", path: "apps/web/src/helper.ts" },
      { kind: "workspace-file", path: "packages/ui/src/index.ts" },
      { kind: "workspace-file", path: "apps/web/src/logo.svg" },
    ])
    expect(snapshot.analysis.diagnostics).toEqual([])
    expect(snapshot.nodes).toContainEqual(expect.objectContaining({ type: "FILE", path: "apps/web/src/logo.svg", fileKind: "asset" }))
    expect(snapshot.relationships.filter((relationship) => relationship.type === "TESTS")).toHaveLength(2)
    const barrel = snapshot.nodes.find((node) => node.type === "FILE" && node.path === "apps/web/src/barrel.ts")
    const helper = snapshot.nodes.find((node) => node.type === "CODE_SYMBOL" && node.name === "helper")
    expect(snapshot.relationships).toContainEqual({ type: "EXPORTS", sourceId: barrel?.id, targetId: helper?.id })
  })

  it("discovers files from registered language adapters", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "specta-adapter-analysis-"))
    temporaryDirectories.push(rootPath)
    await writeFile(join(rootPath, "main.py"), "answer = 42\n")
    const pythonParser: LanguageParser = {
      language: "python",
      extensions: [".py"],
      parse: ({ path, projectId }) => ({
        path,
        ...(projectId ? { projectId } : {}),
        language: "python",
        imports: [], exports: [], symbols: [], tests: [], diagnostics: [],
      }),
    }
    const workspace = singleProjectWorkspace(rootPath, "ws_adapter", "prj_adapter")
    const snapshot = await createWorkspaceAnalyzer({
      parsers: createParserRegistry({ specificationParsers: [markdownSpecificationParser], languageParsers: [pythonParser] }),
    }).compile(workspace)

    expect(snapshot.analysis.sourceFiles).toMatchObject([{ path: "main.py", language: "python" }])
  })

  it("keeps specification IDs stable and references canonical planning entities", () => {
    const base = markdownSpecificationParser.parse({
      path: ".spec/epic.md",
      content: "# Epic — Analysis\n## Requirements\n- Existing requirement.\n",
    })
    const inserted = markdownSpecificationParser.parse({
      path: ".spec/epic.md",
      content: "# Epic — Analysis\n## Requirements\n- New requirement.\n- Existing requirement.\n",
    })
    const project = (specification: typeof base) => projectWorkspaceAnalysis({
      schemaVersion: 1,
      specifications: [specification],
      sourceFiles: [],
      diagnostics: [],
    }, new Map(), new Map([["epic:analysis", "plan_epic"]]))
    const first = project(base)
    const second = project(inserted)
    const existingId = (snapshot: typeof first) => snapshot.nodes.find((node) =>
      node.type === "SPECIFICATION_ENTITY" && node.title === "Existing requirement.")?.id

    expect(existingId(second)).toBe(existingId(first))
    expect(first.nodes.map((node) => node.type)).not.toContain("EPIC")
    expect(first.relationships).toContainEqual(expect.objectContaining({ type: "REFERENCES", targetId: "plan_epic" }))
  })
})

function singleProjectWorkspace(rootPath: string, workspaceId: string, projectId: string): Workspace {
  return {
    schemaVersion: 1,
    id: workspaceId as Workspace["id"],
    rootPath,
    createdAt: "2026-01-01T00:00:00.000Z",
    packageManager: "unknown",
    projects: [{ id: projectId as Workspace["projects"][number]["id"], name: "app", rootPath: ".", kind: "application", manifestPath: "package.json" }],
    artifacts: {},
    workflow: { skillTargets: [], manifestPath: ".specta/workflows/manifest.json" },
  }
}
