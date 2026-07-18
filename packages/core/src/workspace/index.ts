import { createHash, randomUUID } from "node:crypto"
import { dirname, join, relative, resolve } from "node:path"
import {
  createWorkspaceRepository,
  defaultWorkflowConfiguration,
  type WorkspaceRepository,
} from "@specta/core/config"
import {
  ConfigurationError,
  DiscoveryError,
  isRecord,
  type ProjectKind,
  type SkillTarget,
  type Workspace,
  type WorkflowConfiguration,
} from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { nodeFileSystem } from "@specta/core/filesystem"
import { createSkillGenerator, isValidSkillTarget } from "@specta/core/skills"
import { createWorkflowManifestRepository, type WorkflowModule } from "@specta/core/workflow"

export interface ProjectCandidate {
  name: string
  rootPath: string
  manifestPath: string
  kind: ProjectKind
}

export interface DiscoveredWorkspace {
  rootPath: string
  packageManager: Workspace["packageManager"]
  projects: ProjectCandidate[]
}

export interface WorkspaceDiscovery {
  discover(rootPath: string): Promise<DiscoveredWorkspace>
}

export interface InitializeWorkspaceResult {
  workspace: Workspace
  created: boolean
}

export interface InitializeWorkspaceRequest {
  rootPath: string
  skillTargets?: SkillTarget[]
  integrations?: SkillTarget[]
}

export interface WorkspaceInitializer {
  initialize(request: InitializeWorkspaceRequest): Promise<InitializeWorkspaceResult>
}

export interface WorkspaceInitializerOptions {
  discovery?: WorkspaceDiscovery
  repository?: WorkspaceRepository
  fileSystem?: FileSystem
  workflowModules?: WorkflowModule[]
}

export function createWorkspaceDiscovery(fileSystem: FileSystem = nodeFileSystem): WorkspaceDiscovery {
  return {
    async discover(inputPath) {
      const rootPath = resolve(inputPath)
      try {
        await fileSystem.listDirectories(rootPath)
        const rootManifest = await readPackageManifest(fileSystem, rootPath)
        const pnpmPatterns = await readPnpmWorkspacePatterns(fileSystem, rootPath)
        const patterns = pnpmPatterns.length > 0 ? pnpmPatterns : getPackageWorkspacePatterns(rootManifest)
        const packageManager = await detectPackageManager(fileSystem, rootPath, pnpmPatterns.length > 0)

        if (patterns.length === 0) {
          return { rootPath, packageManager, projects: [toCandidate(rootPath, rootManifest, rootPath)] }
        }

        const directories = await findWorkspacePackageDirectories(fileSystem, rootPath, patterns)
        if (directories.length === 0) {
          throw new DiscoveryError("No projects match this workspace's package patterns.")
        }
        const projects = await Promise.all(directories.map(async (directory) =>
          toCandidate(rootPath, await readPackageManifest(fileSystem, directory), directory),
        ))
        return { rootPath, packageManager, projects: projects.sort((a, b) => a.rootPath.localeCompare(b.rootPath)) }
      } catch (error) {
        if (error instanceof DiscoveryError) throw error
        throw new DiscoveryError("Unable to discover a workspace at " + rootPath + ".", error)
      }
    },
  }
}

export function createWorkspaceInitializer(
  options: WorkspaceInitializerOptions = {},
): WorkspaceInitializer {
  const fileSystem = options.fileSystem ?? nodeFileSystem
  const discovery = options.discovery ?? createWorkspaceDiscovery(fileSystem)
  const repository = options.repository ?? createWorkspaceRepository(fileSystem)
  const workflowModules = options.workflowModules ?? []
  return {
    async initialize({ rootPath, skillTargets, integrations }) {
      if (skillTargets !== undefined && integrations !== undefined) {
        throw new ConfigurationError("Use skillTargets instead of integrations.")
      }
      const requestedSkillTargets = skillTargets ?? integrations
      const normalizedRoot = resolve(rootPath)
      const existing = await repository.load(normalizedRoot)
      if (existing) {
        const workspace: Workspace = {
          ...existing,
          rootPath: normalizedRoot,
          workflow: requestedSkillTargets === undefined
            ? existing.workflow
            : { ...existing.workflow, skillTargets: normalizeSkillTargets(requestedSkillTargets) },
        }
        await ensureWorkflowAssets(workspace, workflowModules, fileSystem)
        await repository.save(workspace)
        return { workspace, created: false }
      }

      const discovered = await discovery.discover(normalizedRoot)
      const workspace: Workspace = {
        schemaVersion: 1,
        id: ("ws_" + randomUUID()) as Workspace["id"],
        rootPath: discovered.rootPath,
        createdAt: new Date().toISOString(),
        packageManager: discovered.packageManager,
        projects: discovered.projects.map((project) => ({
          ...project,
          id: projectId(discovered.rootPath, project.rootPath),
        })),
        artifacts: {},
        workflow: createWorkflowConfiguration(requestedSkillTargets),
      }
      await ensureWorkflowAssets(workspace, workflowModules, fileSystem)
      await repository.save(workspace)
      return { workspace, created: true }
    },
  }
}

function createWorkflowConfiguration(skillTargets: SkillTarget[] | undefined): WorkflowConfiguration {
  return defaultWorkflowConfiguration(normalizeSkillTargets(skillTargets))
}

function normalizeSkillTargets(skillTargets: SkillTarget[] | undefined): SkillTarget[] {
  if (skillTargets === undefined || skillTargets.length === 0) return []
  const selected = [...new Set(skillTargets)]
  for (const target of selected) {
    if (!isValidSkillTarget(target)) {
      throw new ConfigurationError("Invalid Skill target: " + target + ".")
    }
  }
  return selected
}

async function ensureWorkflowAssets(
  workspace: Workspace,
  modules: WorkflowModule[],
  fileSystem: FileSystem,
): Promise<void> {
  const manifest = createWorkflowManifestRepository(modules, fileSystem)
  await manifest.ensure(workspace)
  const skills = createSkillGenerator(manifest, fileSystem)
  const generated = await skills.generate(workspace, workspace.workflow.skillTargets)
  await installSkills(workspace, generated, fileSystem)
  await writeRuntimeConfiguration(workspace, fileSystem)
  await ensureAgentsGuidance(workspace, fileSystem)
}

async function installSkills(workspace: Workspace, generated: string[], fileSystem: FileSystem): Promise<void> {
  await Promise.all(workspace.workflow.skillTargets.flatMap((target) => {
    const installRoot = skillInstallRoot(target)
    if (installRoot === undefined) return []
    const prefix = ".specta/skills/" + target + "/"
    return generated.filter((path) => path.startsWith(prefix)).map(async (path) => {
      const suffix = path.slice(prefix.length)
      const destination = installRoot + "/" + suffix
      const legacyDestination = installRoot + "/" + suffix.replace(/^specta-/, "")
      const legacyPath = join(workspace.rootPath, legacyDestination)
      if (legacyDestination !== destination && await fileSystem.exists(legacyPath)) {
        const content = await fileSystem.readText(legacyPath)
        if (content.includes("— Specta Skill")) {
          await fileSystem.removePath(dirname(legacyPath))
        }
      }
      await fileSystem.writeText(join(workspace.rootPath, destination), await fileSystem.readText(join(workspace.rootPath, path)))
    })
  }))
}

function skillInstallRoot(target: SkillTarget): string | undefined {
  if (target === "codex") return ".codex/skills"
  if (target === "claude-code") return ".claude/skills"
  if (target === "cursor") return ".cursor/skills"
  if (target === "vscode") return ".github/skills"
  return undefined
}

async function writeRuntimeConfiguration(workspace: Workspace, fileSystem: FileSystem): Promise<void> {
  const runner = process.env.SPECTA_CLI_RUNNER ?? "node " + resolve(process.cwd(), "apps/cli/bin/specta.mjs")
  await fileSystem.writeText(join(workspace.rootPath, ".specta", "runtime.json"), JSON.stringify({ cliCommand: runner }, null, 2) + "\n")
}

async function ensureAgentsGuidance(workspace: Workspace, fileSystem: FileSystem): Promise<boolean> {
  const agentsPath = join(workspace.rootPath, "AGENTS.md")
  const managedSection = createAgentsSection(workspace.workflow.skillTargets)
  if (!(await fileSystem.exists(agentsPath))) {
    await fileSystem.writeText(agentsPath, "# Agent Guidance\n\n" + managedSection + "\n")
    return true
  }

  const existing = await fileSystem.readText(agentsPath)
  const start = "<!-- specta:workflows:start -->"
  const end = "<!-- specta:workflows:end -->"
  const startIndex = existing.indexOf(start)
  const endIndex = existing.indexOf(end)
  if (countOccurrences(existing, start) !== countOccurrences(existing, end) ||
      countOccurrences(existing, start) > 1 || (startIndex >= 0 && endIndex < startIndex)) {
    throw new ConfigurationError("AGENTS.md contains an incomplete Specta workflow section.")
  }
  if (startIndex >= 0 && endIndex >= startIndex) {
    const updated = existing.slice(0, startIndex) + managedSection + existing.slice(endIndex + end.length)
    if (updated !== existing) {
      await fileSystem.writeText(agentsPath, updated)
      return true
    }
    return false
  }
  const separator = existing.endsWith("\n") ? "\n" : "\n\n"
  await fileSystem.writeText(agentsPath, existing + separator + managedSection + "\n")
  return true
}

function createAgentsSection(skillTargets: SkillTarget[]): string {
  return [
    "<!-- specta:workflows:start -->",
    "## Specta Workflows",
    "",
    "Use the available Specta workflow commands; each command is defined in the Workflow Manifest.",
    "Selected native Skill targets: " + (skillTargets.length === 0 ? "none" : skillTargets.join(", ")) + ".",
    "Workflow Definitions are stored in .specta/workflows/manifest.json.",
    "<!-- specta:workflows:end -->",
  ].join("\n")
}

function countOccurrences(value: string, target: string): number {
  return value.split(target).length - 1
}

async function detectPackageManager(
  fileSystem: FileSystem,
  rootPath: string,
  hasPnpmWorkspaceFile: boolean,
): Promise<Workspace["packageManager"]> {
  if (hasPnpmWorkspaceFile || await fileSystem.exists(join(rootPath, "pnpm-lock.yaml"))) return "pnpm"
  if (await fileSystem.exists(join(rootPath, "yarn.lock"))) return "yarn"
  if (await fileSystem.exists(join(rootPath, "package-lock.json"))) return "npm"
  return "unknown"
}

async function readPackageManifest(fileSystem: FileSystem, directory: string): Promise<Record<string, unknown>> {
  const manifestPath = join(directory, "package.json")
  if (!(await fileSystem.exists(manifestPath))) return {}
  try {
    const value: unknown = JSON.parse(await fileSystem.readText(manifestPath))
    if (!isRecord(value)) throw new DiscoveryError("Package manifest at " + manifestPath + " must contain an object.")
    return value
  } catch (error) {
    if (error instanceof DiscoveryError) throw error
    throw new DiscoveryError("Package manifest at " + manifestPath + " is not valid JSON.", error)
  }
}

async function readPnpmWorkspacePatterns(fileSystem: FileSystem, rootPath: string): Promise<string[]> {
  const workspacePath = join(rootPath, "pnpm-workspace.yaml")
  if (!(await fileSystem.exists(workspacePath))) return []
  const lines = (await fileSystem.readText(workspacePath)).split(/\r?\n/)
  const patterns: string[] = []
  let inPackages = false
  for (const line of lines) {
    if (/^packages\s*:\s*$/.test(line)) {
      inPackages = true
      continue
    }
    if (inPackages && /^\S/.test(line)) break
    if (!inPackages) continue
    const match = line.match(/^\s*-\s*["']?([^"'#]+)["']?\s*(?:#.*)?$/)
    if (match?.[1]) patterns.push(match[1].trim())
  }
  return patterns
}

function getPackageWorkspacePatterns(manifest: Record<string, unknown>): string[] {
  const workspaces = manifest.workspaces
  if (Array.isArray(workspaces)) return workspaces.filter((item): item is string => typeof item === "string")
  if (isRecord(workspaces) && Array.isArray(workspaces.packages)) {
    return workspaces.packages.filter((item): item is string => typeof item === "string")
  }
  return []
}

async function findWorkspacePackageDirectories(
  fileSystem: FileSystem,
  rootPath: string,
  patterns: string[],
): Promise<string[]> {
  const directories = new Set<string>()
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) continue
    const searchRoot = join(rootPath, ...staticPatternPrefix(pattern))
    if (!(await fileSystem.exists(searchRoot))) continue
    directories.add(searchRoot)
    for (const directory of await listDirectoriesRecursively(fileSystem, searchRoot)) directories.add(directory)
  }
  const matches = [...directories].filter((directory) => {
    const path = relative(rootPath, directory).replaceAll("\\", "/")
    const included = patterns.some((pattern) => !pattern.startsWith("!") && matchesWorkspacePattern(path, pattern))
    const excluded = patterns.some((pattern) => pattern.startsWith("!") && matchesWorkspacePattern(path, pattern.slice(1)))
    return included && !excluded
  })
  const packageDirectories: string[] = []
  for (const directory of matches) {
    if (await fileSystem.exists(join(directory, "package.json"))) packageDirectories.push(directory)
  }
  return packageDirectories
}

async function listDirectoriesRecursively(fileSystem: FileSystem, rootPath: string): Promise<string[]> {
  const directories: string[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const name of await fileSystem.listDirectories(directory)) {
      if (isIgnoredDirectory(name)) continue
      const child = join(directory, name)
      directories.push(child)
      await walk(child)
    }
  }
  await walk(rootPath)
  return directories
}

function staticPatternPrefix(pattern: string): string[] {
  const segments = pattern.trim().replace(/^\.\//, "").split("/")
  const wildcardIndex = segments.findIndex((segment) => segment.includes("*"))
  return wildcardIndex === -1 ? segments : segments.slice(0, wildcardIndex)
}

function matchesWorkspacePattern(path: string, pattern: string): boolean {
  const pathSegments = path.split("/").filter(Boolean)
  const patternSegments = pattern.trim().replace(/^\.\//, "").replace(/\/+$/, "").split("/").filter(Boolean)
  return matchesSegments(pathSegments, patternSegments)
}

function matchesSegments(path: string[], pattern: string[], pathIndex = 0, patternIndex = 0): boolean {
  if (patternIndex === pattern.length) return pathIndex === path.length
  const currentPattern = pattern[patternIndex]
  if (currentPattern === "**") {
    if (patternIndex === pattern.length - 1) return true
    for (let nextPathIndex = pathIndex; nextPathIndex <= path.length; nextPathIndex += 1) {
      if (matchesSegments(path, pattern, nextPathIndex, patternIndex + 1)) return true
    }
    return false
  }
  if (pathIndex === path.length || currentPattern === undefined) return false
  return matchesSegment(path[pathIndex] as string, currentPattern) &&
    matchesSegments(path, pattern, pathIndex + 1, patternIndex + 1)
}

function matchesSegment(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replaceAll("*", ".*")
  return new RegExp("^" + escaped + "$").test(value)
}

function isIgnoredDirectory(name: string): boolean {
  return [".git", ".next", ".specta", ".turbo", "build", "coverage", "dist", "node_modules"].includes(name)
}

function toCandidate(rootPath: string, manifest: Record<string, unknown>, directory: string): ProjectCandidate {
  const rootPathRelative = relative(rootPath, directory) || "."
  const name = typeof manifest.name === "string" ? manifest.name : rootPathRelative
  return {
    name,
    rootPath: rootPathRelative,
    manifestPath: join(rootPathRelative, "package.json"),
    kind: inferProjectKind(rootPathRelative),
  }
}

function inferProjectKind(rootPath: string): ProjectKind {
  if (/(^|\/)(apps?|web|frontend|backend)(\/|$)/.test(rootPath)) return "application"
  if (/(^|\/)(services?)(\/|$)/.test(rootPath)) return "service"
  if (/(^|\/)(packages?|libs?)(\/|$)/.test(rootPath)) return "package"
  return "unknown"
}

function projectId(workspaceRoot: string, projectRoot: string): Workspace["projects"][number]["id"] {
  return ("prj_" + createHash("sha256").update(workspaceRoot + ":" + projectRoot).digest("hex").slice(0, 16)) as Workspace["projects"][number]["id"]
}
