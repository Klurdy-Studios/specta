import { join, posix } from "node:path"
import { isRecord, type ProjectId } from "@specta/core"
import type { ModuleResolver, ModuleResolverContext } from "./contracts.ts"
import { normalizePath } from "../analysis/identifiers.ts"

interface TypeScriptResolutionConfig {
  projectRoot: string
  baseUrl: string
  paths: Record<string, string[]>
}

/** Prepares deterministic TypeScript resolution using workspace packages and each project's tsconfig paths. */
export async function createTypeScriptModuleResolver(context: ModuleResolverContext): Promise<ModuleResolver> {
  const configurations = new Map<ProjectId, TypeScriptResolutionConfig>()
  for (const project of context.workspace.projects) {
    configurations.set(project.id, await readResolutionConfig(context, project.rootPath))
  }
  return {
    resolve({ importingPath, specifier, projectId }) {
      if (specifier.startsWith(".")) {
        return resolveWorkspaceCandidate(
          normalizePath(posix.join(posix.dirname(normalizePath(importingPath)), specifier)),
          specifier,
          context.knownPaths,
        )
      }

      const configuration = projectId ? configurations.get(projectId) : undefined
      let matchedAlias = false
      if (configuration) {
        for (const [pattern, targets] of Object.entries(configuration.paths)) {
          const wildcard = matchPattern(pattern, specifier)
          if (wildcard === undefined) continue
          matchedAlias = true
          for (const target of targets) {
            const candidate = normalizePath(posix.join(
              configuration.projectRoot,
              configuration.baseUrl,
              target.replace("*", wildcard),
            ))
            const resolved = findCandidate(candidate, context.knownPaths)
            if (resolved) return { kind: "workspace-file", path: resolved }
          }
        }
      }

      for (const project of context.workspace.projects) {
        if (specifier !== project.name && !specifier.startsWith(project.name + "/")) continue
        const subpath = specifier === project.name ? "" : specifier.slice(project.name.length + 1)
        const roots = subpath
          ? [posix.join(project.rootPath, subpath), posix.join(project.rootPath, "src", subpath)]
          : [posix.join(project.rootPath, "src", "index"), posix.join(project.rootPath, "index")]
        for (const root of roots) {
          const resolved = findCandidate(normalizePath(root), context.knownPaths)
          if (resolved) return { kind: "workspace-file", path: resolved }
        }
        return { kind: "unresolved", specifier }
      }

      if (matchedAlias) return { kind: "unresolved", specifier }
      const packageName = externalPackageName(specifier)
      return packageName ? { kind: "external", packageName } : { kind: "unresolved", specifier }
    },
  }
}

async function readResolutionConfig(
  context: ModuleResolverContext,
  projectRoot: string,
): Promise<TypeScriptResolutionConfig> {
  const path = join(context.workspace.rootPath, projectRoot, "tsconfig.json")
  if (!(await context.fileSystem.exists(path))) return { projectRoot, baseUrl: ".", paths: {} }
  try {
    const value: unknown = JSON.parse(stripJsonComments(await context.fileSystem.readText(path)))
    const compilerOptions = isRecord(value) && isRecord(value.compilerOptions) ? value.compilerOptions : {}
    const baseUrl = typeof compilerOptions.baseUrl === "string" ? compilerOptions.baseUrl : "."
    const paths: Record<string, string[]> = {}
    if (isRecord(compilerOptions.paths)) {
      for (const [pattern, targets] of Object.entries(compilerOptions.paths)) {
        if (Array.isArray(targets) && targets.every((target) => typeof target === "string")) paths[pattern] = targets
      }
    }
    return { projectRoot, baseUrl, paths }
  } catch {
    return { projectRoot, baseUrl: ".", paths: {} }
  }
}

function resolveWorkspaceCandidate(base: string, specifier: string, knownPaths: ReadonlySet<string>) {
  const resolved = findCandidate(base, knownPaths)
  return resolved ? { kind: "workspace-file" as const, path: resolved } : { kind: "unresolved" as const, specifier }
}

function findCandidate(base: string, knownPaths: ReadonlySet<string>): string | undefined {
  const sourceBase = base.replace(/\.jsx?$/, "").replace(/\.mjs$/, ".mts").replace(/\.cjs$/, ".cts")
  return [base, sourceBase, sourceBase + ".ts", sourceBase + ".tsx", sourceBase + ".mts", sourceBase + ".cts", ...[
    "index.ts", "index.tsx", "index.mts", "index.cts",
  ].map((name) => posix.join(sourceBase, name))].find((candidate) => knownPaths.has(candidate))
}

function matchPattern(pattern: string, specifier: string): string | undefined {
  const wildcardIndex = pattern.indexOf("*")
  if (wildcardIndex < 0) return pattern === specifier ? "" : undefined
  const prefix = pattern.slice(0, wildcardIndex)
  const suffix = pattern.slice(wildcardIndex + 1)
  return specifier.startsWith(prefix) && specifier.endsWith(suffix)
    ? specifier.slice(prefix.length, specifier.length - suffix.length)
    : undefined
}

function externalPackageName(specifier: string): string | undefined {
  const segments = specifier.split("/")
  if (!segments[0]) return undefined
  return specifier.startsWith("@") && segments[1] ? segments.slice(0, 2).join("/") : segments[0]
}

function stripJsonComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1")
}
