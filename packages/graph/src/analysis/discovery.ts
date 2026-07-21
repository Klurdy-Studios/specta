import { join, relative } from "node:path"
import type { Workspace } from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import type { ParserRegistry } from "../parser/index.ts"
import { normalizePath } from "./identifiers.ts"

const ignoredDirectories = new Set([".git", ".next", ".specta", ".turbo", "build", "coverage", "dist", "node_modules", "out"])
export interface DiscoveredSourceFile {
  path: string
  absolutePath: string
  projectId: Workspace["projects"][number]["id"]
  projectRoot: string
}

export interface DiscoveredAnalysisFiles {
  specifications: Array<{ path: string; absolutePath: string }>
  sourceFiles: DiscoveredSourceFile[]
  workspaceFiles: string[]
}

/** Finds supported specification and source files while excluding generated/build trees. */
export async function discoverAnalysisFiles(
  workspace: Workspace,
  fileSystem: FileSystem,
  parsers: ParserRegistry,
): Promise<DiscoveredAnalysisFiles> {
  const specifications: Array<{ path: string; absolutePath: string }> = []
  const specificationRoots = [
    join(workspace.rootPath, ".spec"),
    join(workspace.rootPath, ".specta", "planning"),
  ]
  for (const specificationRoot of specificationRoots) {
    if (await fileSystem.exists(specificationRoot)) {
      for (const absolutePath of await walkFiles(fileSystem, specificationRoot, false)) {
        const path = normalizePath(relative(workspace.rootPath, absolutePath))
        if (parsers.specificationParser(path)) specifications.push({ path, absolutePath })
      }
    }
  }

  const sourceByPath = new Map<string, DiscoveredSourceFile>()
  const workspaceFiles = new Set<string>()
  const projects = [...workspace.projects].sort((a, b) => b.rootPath.length - a.rootPath.length)
  const projectFiles = await Promise.all(projects.map(async (project) => {
    const projectAbsoluteRoot = join(workspace.rootPath, project.rootPath)
    return { project, files: await walkFiles(fileSystem, projectAbsoluteRoot, true) }
  }))
  for (const { project, files } of projectFiles) {
    for (const absolutePath of files) {
      const path = normalizePath(relative(workspace.rootPath, absolutePath))
      workspaceFiles.add(path)
      if (!parsers.languageParser(path)) continue
      if (!sourceByPath.has(path)) {
        sourceByPath.set(path, {
          path,
          absolutePath,
          projectId: project.id,
          projectRoot: normalizePath(project.rootPath),
        })
      }
    }
  }
  return {
    specifications: specifications.sort((a, b) => a.path.localeCompare(b.path)),
    sourceFiles: [...sourceByPath.values()].sort((a, b) => a.path.localeCompare(b.path)),
    workspaceFiles: [...workspaceFiles].sort(),
  }
}

async function walkFiles(fileSystem: FileSystem, rootPath: string, ignoreGenerated: boolean): Promise<string[]> {
  const result: string[] = []
  const visit = async (directory: string): Promise<void> => {
    const entries = (await fileSystem.listEntries(directory)).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.kind === "file") result.push(join(directory, entry.name))
    }
    for (const entry of entries) {
      if (entry.kind !== "directory") continue
      const name = entry.name
      if (ignoreGenerated && (ignoredDirectories.has(name) || name === ".spec")) continue
      await visit(join(directory, name))
    }
  }
  await visit(rootPath)
  return result
}
