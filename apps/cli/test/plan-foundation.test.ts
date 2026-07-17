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

it("submits agent-authored Foundation JSON through the CLI", async () => {
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
}, 15_000)

function runCli(arguments_: string[], cwd: string): Promise<{ stdout: string, stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [cliPath, ...arguments_], { cwd }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || stdout, { cause: error }))
      else resolve({ stdout, stderr })
    })
  })
}
