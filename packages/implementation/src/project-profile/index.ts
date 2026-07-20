import { basename, join } from "node:path"
import {
  projectProfileSchema,
  type BootstrapPlan,
  type ProjectProfile,
  type ProjectTarget,
  type TechnicalDesignId,
  type Workspace,
} from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { nodeFileSystem } from "@specta/core/filesystem"

export interface ProjectProfileResolver {
  resolve(workspace: Workspace, target: ProjectTarget): Promise<ProjectProfile>
}

/** Detects framework metadata without treating frameworks as adapter boundaries. */
export function createProjectProfileResolver(
  fileSystem: FileSystem = nodeFileSystem,
): ProjectProfileResolver {
  return {
    async resolve(workspace, target) {
      const profile = target.kind === "new"
        ? profileForNewProject(workspace, target)
        : await profileForExistingProject(workspace, target.projectId, fileSystem)
      return profile
    },
  }
}

export function createBootstrapPlan(
  profile: ProjectProfile,
  designId: TechnicalDesignId,
): BootstrapPlan | undefined {
  if (profile.state !== "blank" || profile.framework === "none") return undefined
  const command = bootstrapCommand(profile)
  if (command === undefined) {
    throw new Error("No deterministic bootstrap recipe is available for framework " + profile.framework + ".")
  }
  return {
    language: profile.language,
    framework: profile.framework,
    cwd: ".",
    command,
    expectedManifests: ["package.json"],
    approvedByDesignId: designId,
  }
}

async function profileForExistingProject(
  workspace: Workspace,
  projectId: Workspace["projects"][number]["id"],
  fileSystem: FileSystem,
): Promise<ProjectProfile> {
  const project = workspace.projects.find((candidate) => candidate.id === projectId)
  if (project === undefined) throw new Error("Target project is not part of the Workspace: " + projectId + ".")
  const absoluteRoot = join(workspace.rootPath, project.rootPath)
  const manifestPath = join(absoluteRoot, "package.json")
  const manifest = await readManifest(fileSystem, manifestPath)
  const dependencies = dependencyNames(manifest)
  const scripts = recordStrings(manifest.scripts)
  const detected = detectFramework(dependencies)
  const evidence: ProjectProfile["evidence"] = []
  if (detected.dependency !== undefined) {
    evidence.push({ kind: "dependency", source: project.manifestPath, value: detected.dependency })
  }
  for (const [name, value] of Object.entries(scripts)) {
    if (detected.dependency !== undefined && value.includes(commandName(detected.dependency))) {
      evidence.push({ kind: "script", source: "package.json#" + name, value })
    }
  }
  const config = await firstExisting(fileSystem, absoluteRoot, detected.configFiles)
  if (config !== undefined) evidence.push({ kind: "configuration", source: config, value: detected.framework })
  const hasTypeScript = dependencies.has("typescript") || await fileSystem.exists(join(absoluteRoot, "tsconfig.json"))
  return projectProfileSchema.parse({
    projectId: project.id,
    name: project.name,
    rootPath: project.rootPath,
    state: "existing",
    language: hasTypeScript ? "typescript" : "javascript",
    framework: detected.framework,
    toolchain: detected.toolchain,
    packageManager: workspace.packageManager,
    sourceRoots: detected.sourceRoots,
    evidence,
    source: "detected",
  })
}

/** Applies deterministic framework conventions without making frameworks adapter boundaries. */
export function validateFrameworkConventions(
  profile: ProjectProfile,
  files: Array<{ path: string, kind: string }>,
): string[] {
  const roots = profile.sourceRoots.map((root) => root.replace(/\/+$/, "") + "/")
  return files.flatMap((file) => {
    if (file.kind === "configuration") return []
    if (roots.some((root) => file.path.startsWith(root))) return []
    if (profile.framework === "nextjs" && ["middleware.ts", "instrumentation.ts"].includes(file.path)) return []
    return ["File " + file.path + " is outside the source roots for " + profile.framework + ": " + profile.sourceRoots.join(", ") + "."]
  })
}

function commandName(dependency: string): string {
  if (dependency === "@angular/core") return "ng"
  if (dependency === "@nestjs/core") return "nest"
  return dependency === "next" ? "next" : dependency
}

function profileForNewProject(workspace: Workspace, target: Extract<ProjectTarget, { kind: "new" }>): ProjectProfile {
  return projectProfileSchema.parse({
    name: target.name,
    rootPath: target.rootPath,
    state: "blank",
    language: target.framework.language,
    framework: target.framework.framework,
    toolchain: target.framework.toolchain,
    packageManager: workspace.packageManager,
    sourceRoots: sourceRoots(target.framework.framework),
    evidence: [],
    source: "technical-design",
  })
}

function detectFramework(dependencies: Set<string>): {
  framework: string
  toolchain: string
  dependency?: string
  sourceRoots: string[]
  configFiles: string[]
} {
  const candidates = [
    { dependency: "next", framework: "nextjs", toolchain: "next", configFiles: ["next.config.ts", "next.config.js"] },
    { dependency: "@angular/core", framework: "angular", toolchain: "angular-cli", configFiles: ["angular.json"] },
    { dependency: "@nestjs/core", framework: "nestjs", toolchain: "nest-cli", configFiles: ["nest-cli.json"] },
    { dependency: "react", framework: "react", toolchain: dependencies.has("vite") ? "vite" : "custom", configFiles: ["vite.config.ts"] },
    { dependency: "express", framework: "express", toolchain: "custom", configFiles: [] },
  ]
  let matches = candidates.filter((candidate) => dependencies.has(candidate.dependency))
  if (matches.some((candidate) => candidate.framework === "nextjs")) {
    matches = matches.filter((candidate) => candidate.framework !== "react")
  }
  if (matches.some((candidate) => candidate.framework === "nestjs")) {
    matches = matches.filter((candidate) => candidate.framework !== "express")
  }
  if (matches.length > 1) {
    throw new Error("Framework detection is ambiguous: " + matches.map((candidate) => candidate.framework).join(", ") + ".")
  }
  const match = matches[0]
  if (match === undefined) return { framework: "none", toolchain: "none", sourceRoots: ["src"], configFiles: [] }
  return { ...match, sourceRoots: sourceRoots(match.framework) }
}

function sourceRoots(framework: string): string[] {
  if (framework === "nextjs") return ["app", "pages", "src"]
  return ["src"]
}

function bootstrapCommand(profile: ProjectProfile): BootstrapPlan["command"] | undefined {
  const path = profile.rootPath || "."
  const runner = profile.packageManager === "pnpm" ? "pnpm" : "npx"
  const dlx = profile.packageManager === "pnpm" ? ["dlx"] : []
  if (profile.framework === "nextjs") return { executable: runner, arguments: [...dlx, "create-next-app@latest", path, "--ts"] }
  if (profile.framework === "react" && profile.toolchain === "vite") {
    return { executable: runner, arguments: [...dlx, "create-vite@latest", path, "--template", "react-ts"] }
  }
  if (profile.framework === "angular") {
    return { executable: runner, arguments: [...dlx, "@angular/cli@latest", "new", basename(path), "--directory", path] }
  }
  if (profile.framework === "nestjs") {
    return { executable: runner, arguments: [...dlx, "@nestjs/cli@latest", "new", path, "--package-manager", profile.packageManager] }
  }
  if (profile.framework === "express") {
    return { executable: profile.packageManager === "unknown" ? "npm" : profile.packageManager, arguments: ["init", "-y", "--prefix", path] }
  }
  return undefined
}

async function readManifest(fileSystem: FileSystem, path: string): Promise<Record<string, unknown>> {
  if (!(await fileSystem.exists(path))) return {}
  const value: unknown = JSON.parse(await fileSystem.readText(path))
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
}

function dependencyNames(manifest: Record<string, unknown>): Set<string> {
  return new Set([...Object.keys(recordStrings(manifest.dependencies)), ...Object.keys(recordStrings(manifest.devDependencies))])
}

function recordStrings(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
}

async function firstExisting(fileSystem: FileSystem, root: string, candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) if (await fileSystem.exists(join(root, candidate))) return candidate
  return undefined
}
