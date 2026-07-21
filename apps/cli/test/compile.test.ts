import { execFile } from "node:child_process"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Workspace } from "@specta/core"
import { createWorkspaceRepository, defaultWorkflowConfiguration } from "@specta/core/config"
import { nodeFileSystem } from "@specta/core/filesystem"
import { createAnalysisGraphRepository } from "@specta/graph"
import { afterEach, expect, it } from "vitest"

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "../bin/specta.mjs")
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

it("compiles specification and source analysis from the CLI", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "specta-cli-compile-"))
  temporaryDirectories.push(rootPath)
  await mkdir(join(rootPath, ".spec"), { recursive: true })
  await mkdir(join(rootPath, "src"), { recursive: true })
  await writeFile(join(rootPath, ".spec", "requirements.md"), "# Product\n## Requirements\n- Be testable.\n")
  await writeFile(join(rootPath, "src", "index.ts"), "export const ready = true\n")
  const workspace: Workspace = {
    schemaVersion: 1,
    id: "ws_cli_compile" as Workspace["id"],
    rootPath,
    createdAt: "2026-01-01T00:00:00.000Z",
    packageManager: "unknown",
    projects: [{ id: "prj_cli_compile" as Workspace["projects"][number]["id"], name: "app", rootPath: ".", kind: "application", manifestPath: "package.json" }],
    artifacts: {},
    workflow: defaultWorkflowConfiguration(),
  }
  await createWorkspaceRepository(nodeFileSystem).save(workspace)

  const result = await runCli(rootPath, ["compile"])
  const snapshot = await createAnalysisGraphRepository().load(workspace)

  expect(result.stderr).toBe("")
  expect(snapshot?.nodes.some((node: { type: string; entityKind?: string }) =>
    node.type === "SPECIFICATION_ENTITY" && node.entityKind === "requirement")).toBe(true)
  expect(snapshot?.nodes.some((node: { type: string }) => node.type === "CODE_SYMBOL")).toBe(true)
}, 15_000)

function runCli(cwd: string, arguments_: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [cliPath, ...arguments_], { cwd }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message))
      else resolve({ stdout, stderr })
    })
  })
}
