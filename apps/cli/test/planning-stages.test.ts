import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, expect, it } from "vitest"

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "../bin/specta.mjs")
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

it("submits agent-authored planning stages through the CLI", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "specta-cli-foundation-"))
  temporaryDirectories.push(rootPath)
  await writeFile(join(rootPath, "package.json"), JSON.stringify({ name: "foundation-test", private: true }) + "\n")
  await runCli(["init", ".", "--agent", "codex"], rootPath)
  await mkdir(join(rootPath, ".specta", "drafts"), { recursive: true })
  await writeFile(join(rootPath, ".specta", "drafts", "plan-foundation.json"), JSON.stringify({
    vision: {
      title: "Task Atlas",
      problem: "Small teams lose track of project work and ownership.",
      audience: "Small product teams.",
      outcome: "Teams can plan and complete traceable work.",
    },
    constitution: {
      principles: ["Keep work traceable from intent to completion.", "Prefer simple team workflows."],
    },
  }, null, 2) + "\n")

  await runCli([
    "plan",
    "foundation",
    "Build a task tracker for small product teams.",
    "--draft",
    ".specta/drafts/plan-foundation.json",
  ], rootPath)

  await expect(readFile(join(rootPath, ".specta", "planning", "vision.md"), "utf8"))
    .resolves.toContain("## Task Atlas")
  await expect(readFile(join(rootPath, ".specta", "planning", "constitution.md"), "utf8"))
    .resolves.toContain("Prefer simple team workflows.")
  const graph = JSON.parse(await readFile(join(rootPath, ".specta", "graph", "planning-relationships.json"), "utf8"))
  expect(graph.completedStages).toEqual(["foundation"])
  expect(graph.nodes.map((node: { type: string }) => node.type)).toEqual(["VISION", "CONSTITUTION"])

  await writeFile(join(rootPath, ".specta", "drafts", "plan-architecture.json"), JSON.stringify({
    overview: "A workflow-centered system keeps task planning and delivery traceable.",
    components: [
      "Planning boundary — captures and validates project intent",
      "Workflow boundary — coordinates task lifecycle",
      "Graph boundary — preserves traceability between intent and delivery",
    ],
  }, null, 2) + "\n")

  await runCli([
    "plan",
    "architecture",
    "Use a local-first TypeScript architecture with SQLite.",
    "--draft",
    ".specta/drafts/plan-architecture.json",
  ], rootPath)

  await expect(readFile(join(rootPath, ".specta", "planning", "architecture.md"), "utf8"))
    .resolves.toContain("Workflow boundary — coordinates task lifecycle")
  await expect(readFile(join(rootPath, ".specta", "planning", "architecture.md"), "utf8"))
    .resolves.toContain("Use a local-first TypeScript architecture with SQLite.")
  const architectureGraph = JSON.parse(await readFile(join(rootPath, ".specta", "graph", "planning-relationships.json"), "utf8"))
  expect(architectureGraph.completedStages).toEqual(["foundation", "architecture"])
  expect(architectureGraph.nodes.map((node: { type: string }) => node.type)).toEqual([
    "VISION",
    "CONSTITUTION",
    "ARCHITECTURE",
  ])
  expect(architectureGraph.relationships).toHaveLength(2)
  expect(architectureGraph.planning.architecture.guidance)
    .toBe("Use a local-first TypeScript architecture with SQLite.")

  await writeFile(join(rootPath, ".specta", "drafts", "plan-roadmap.json"), JSON.stringify({
    milestones: [
      {
        title: "Traceable planning",
        objective: "Give product teams an approved, graph-backed plan.",
        outcomes: ["Teams can create and inspect traceable project plans."],
      },
      {
        title: "Reliable delivery",
        objective: "Connect approved plans to validated delivery work.",
        outcomes: ["Delivery work remains linked to its planning intent."],
      },
    ],
  }, null, 2) + "\n")

  await runCli([
    "plan",
    "roadmap",
    "--draft",
    ".specta/drafts/plan-roadmap.json",
  ], rootPath)

  const roadmapMarkdown = await readFile(join(rootPath, ".specta", "planning", "roadmap.md"), "utf8")
  expect(roadmapMarkdown).toContain("## 1. Traceable planning")
  expect(roadmapMarkdown).toContain("**Objective:** Give product teams an approved, graph-backed plan.")
  expect(roadmapMarkdown).toContain("- Delivery work remains linked to its planning intent.")
  const roadmapGraph = JSON.parse(await readFile(join(rootPath, ".specta", "graph", "planning-relationships.json"), "utf8"))
  expect(roadmapGraph.completedStages).toEqual(["foundation", "architecture", "roadmap"])
  expect(roadmapGraph.nodes.at(-1).type).toBe("ROADMAP")
  expect(roadmapGraph.relationships.at(-1)).toEqual({
    type: "DEPENDS_ON",
    sourceId: roadmapGraph.planning.roadmap.id,
    targetId: roadmapGraph.planning.architecture.id,
  })
}, 20_000)

function runCli(arguments_: string[], cwd: string): Promise<{ stdout: string, stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [cliPath, ...arguments_], { cwd }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || stdout, { cause: error }))
      else resolve({ stdout, stderr })
    })
  })
}
