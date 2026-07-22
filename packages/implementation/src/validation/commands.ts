import { spawn } from "node:child_process"
import { join, posix } from "node:path"
import type { ProjectProfile, Workspace } from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import type { ValidationCommand, ValidationCommandResult, ValidationCommandRunner } from "@specta/core/validation"

const OUTPUT_LIMIT = 16_384
const DEFAULT_TIMEOUT_MS = 120_000

export interface ValidationTestTarget {
  path: string
  framework: "vitest" | "jest" | "node" | "unknown"
}

/** Discovers deterministic validation scripts for the target and blast-radius projects. */
export async function discoverValidationCommands(
  workspace: Workspace,
  profile: ProjectProfile,
  impactedPaths: string[],
  fileSystem: FileSystem,
  requiredTests: ValidationTestTarget[] = [],
): Promise<{ commands: ValidationCommand[], missingTestProjects: string[] }> {
  const requestedRoots = new Map<string, string | undefined>()
  requestedRoots.set(profile.rootPath, profile.projectId)
  for (const path of [...impactedPaths, ...requiredTests.map((test) => test.path)]) {
    const project = owningProject(workspace, path)
    if (project) requestedRoots.set(project.rootPath, project.id)
  }
  const roots = new Map<string, {
    projectId?: string
    scripts: Record<string, unknown>
    tests: Map<string, ValidationTestTarget>
  }>()
  const missingTestProjects: string[] = []
  for (const [requestedRoot, projectId] of requestedRoots) {
    const owner = await validationOwner(workspace, requestedRoot, projectId, fileSystem)
    if (!owner) {
      missingTestProjects.push(requestedRoot)
      continue
    }
    const selected = roots.get(owner.rootPath) ?? {
      ...(owner.projectId ? { projectId: owner.projectId } : {}),
      scripts: owner.scripts,
      tests: new Map<string, ValidationTestTarget>(),
    }
    for (const test of requiredTests) {
      if (pathBelongsToRoot(test.path, requestedRoot)) {
        const path = posix.normalize(test.path.replaceAll("\\", "/"))
        selected.tests.set(path + "\0" + test.framework, { path, framework: test.framework })
      }
    }
    roots.set(owner.rootPath, selected)
  }
  const commands: ValidationCommand[] = []
  for (const [rootPath, details] of [...roots].sort(([left], [right]) => left.localeCompare(right))) {
    const cwd = join(workspace.rootPath, rootPath)
    const scripts = details.scripts
    const packageManager = workspace.packageManager === "unknown" ? profile.packageManager : workspace.packageManager
    commands.push(command(packageManager, "test", cwd, details.projectId))
    commands.push(...targetedTestCommands(
      packageManager,
      cwd,
      rootPath,
      details.projectId,
      [...details.tests.values()],
    ))
    const checkScript = typeof scripts.check === "string" ? "check"
      : typeof scripts.typecheck === "string" ? "typecheck"
      : undefined
    if (checkScript) commands.push(command(packageManager, "check", cwd, details.projectId, checkScript))
    if (typeof scripts.lint === "string") commands.push(command(packageManager, "lint", cwd, details.projectId))
  }
  return { commands, missingTestProjects: [...new Set(missingTestProjects)].sort() }
}

/** Creates the shell-free Node process runner used by full validation. */
export function createValidationCommandRunner(): ValidationCommandRunner {
  return {
    run(command) {
      return new Promise((resolve) => {
        const child = spawn(command.executable, command.arguments, {
          cwd: command.cwd,
          shell: false,
          detached: process.platform !== "win32",
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        })
        let stdout = ""
        let stderr = ""
        let timedOut = false
        let settled = false
        let killTimeout: ReturnType<typeof setTimeout> | undefined
        const append = (current: string, chunk: unknown) =>
          (current + String(chunk)).slice(-OUTPUT_LIMIT)
        child.stdout?.on("data", (chunk) => { stdout = append(stdout, chunk) })
        child.stderr?.on("data", (chunk) => { stderr = append(stderr, chunk) })
        const timeout = setTimeout(() => {
          timedOut = true
          terminateProcessTree(child.pid, "SIGTERM")
          killTimeout = setTimeout(() => terminateProcessTree(child.pid, "SIGKILL"), 1_000)
        }, command.timeoutMs)
        const finish = (exitCode: number | null, error?: Error) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          if (killTimeout) clearTimeout(killTimeout)
          resolve(result(command, exitCode, timedOut, stdout, error ? append(stderr, error.message) : stderr))
        }
        child.on("error", (error) => {
          finish(null, error)
        })
        child.on("close", (exitCode) => {
          finish(exitCode)
        })
      })
    },
  }
}

function command(
  packageManager: Workspace["packageManager"],
  kind: ValidationCommand["kind"],
  cwd: string,
  projectId?: string,
  script: string = kind,
): ValidationCommand {
  const executable = packageManager === "unknown" ? "npm" : packageManager
  const arguments_ = executable === "yarn" ? [script] : ["run", script]
  return {
    kind,
    executable,
    arguments: arguments_,
    cwd,
    ...(projectId ? { projectId } : {}),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }
}

function targetedTestCommands(
  packageManager: Workspace["packageManager"],
  cwd: string,
  rootPath: string,
  projectId: string | undefined,
  tests: ValidationTestTarget[],
): ValidationCommand[] {
  const grouped = new Map<ValidationTestTarget["framework"], string[]>()
  for (const test of tests) {
    if (test.framework === "unknown") continue
    const paths = grouped.get(test.framework) ?? []
    paths.push(test.path)
    grouped.set(test.framework, paths)
  }
  return [...grouped].sort(([left], [right]) => left.localeCompare(right)).map(([framework, workspacePaths]) => {
    const testPaths = [...new Set(workspacePaths)].sort()
    const paths = testPaths.map((path) => relativeProjectPath(rootPath, path))
    if (framework === "node") return {
      kind: "test",
      executable: process.execPath,
      arguments: ["--test", ...paths],
      cwd,
      ...(projectId ? { projectId } : {}),
      testPaths,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    }
    const executable = packageManager === "pnpm" ? "pnpm"
      : packageManager === "yarn" ? "yarn"
      : packageManager === "npm" ? "npm"
      : "npx"
    const arguments_ = executable === "pnpm" ? ["exec", framework, ...(framework === "vitest" ? ["run"] : []), ...paths]
      : executable === "yarn" ? [framework, ...(framework === "vitest" ? ["run"] : []), ...paths]
      : executable === "npm" ? ["exec", "--", framework, ...(framework === "vitest" ? ["run"] : []), ...paths]
      : ["--no-install", framework, ...(framework === "vitest" ? ["run"] : []), ...paths]
    return {
      kind: "test",
      executable,
      arguments: arguments_,
      cwd,
      ...(projectId ? { projectId } : {}),
      testPaths,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    }
  })
}

async function validationOwner(
  workspace: Workspace,
  requestedRoot: string,
  projectId: string | undefined,
  fileSystem: FileSystem,
): Promise<{ rootPath: string, projectId?: string, scripts: Record<string, unknown> } | undefined> {
  const candidates = [
    { rootPath: requestedRoot, ...(projectId ? { projectId } : {}) },
    ...workspace.projects
      .filter((project) => project.rootPath !== requestedRoot && pathBelongsToRoot(requestedRoot, project.rootPath))
      .map((project) => ({ rootPath: project.rootPath, projectId: project.id })),
    ...(requestedRoot === "." ? [] : [{ rootPath: "." }]),
  ].sort((left, right) => right.rootPath.length - left.rootPath.length)
  for (const candidate of candidates) {
    const scripts = await readScripts(join(workspace.rootPath, candidate.rootPath, "package.json"), fileSystem)
    if (scripts && typeof scripts.test === "string" && scripts.test.trim()) return { ...candidate, scripts }
  }
  return undefined
}

async function readScripts(path: string, fileSystem: FileSystem): Promise<Record<string, unknown> | undefined> {
  if (!(await fileSystem.exists(path))) return undefined
  try {
    const manifest = JSON.parse(await fileSystem.readText(path)) as { scripts?: Record<string, unknown> }
    return manifest.scripts ?? {}
  } catch {
    return undefined
  }
}

function pathBelongsToRoot(path: string, rootPath: string): boolean {
  const normalized = posix.normalize(path.replaceAll("\\", "/"))
  return rootPath === "." || normalized === rootPath || normalized.startsWith(rootPath + "/")
}

function relativeProjectPath(rootPath: string, path: string): string {
  const normalized = posix.normalize(path.replaceAll("\\", "/"))
  return rootPath === "." ? normalized : posix.relative(rootPath, normalized)
}

function terminateProcessTree(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(pid), "/t", ...(signal === "SIGKILL" ? ["/f"] : [])], {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    })
    killer.unref()
    return
  }
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      // The process tree may already have exited between the timeout and signal.
    }
  }
}

function result(
  command: ValidationCommand,
  exitCode: number | null,
  timedOut: boolean,
  stdout: string,
  stderr: string,
): ValidationCommandResult {
  return {
    command,
    status: !timedOut && exitCode === 0 ? "passed" : "failed",
    exitCode,
    timedOut,
    stdout,
    stderr,
  }
}

function owningProject(workspace: Workspace, path: string): Workspace["projects"][number] | undefined {
  const normalized = posix.normalize(path.replaceAll("\\", "/"))
  return [...workspace.projects]
    .filter((project) => project.rootPath === "." || normalized === project.rootPath || normalized.startsWith(project.rootPath + "/"))
    .sort((left, right) => right.rootPath.length - left.rootPath.length)[0]
}
