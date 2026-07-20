import { join, relative } from "node:path"
import type { Workspace } from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { normalizePath } from "./identifiers.ts"

const ignoredDirectories = new Set([".git", ".next", ".specta", ".turbo", "build", "coverage", "dist", "node_modules", "out"])
const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"])

export interface DiscoveredSourceFile {
  path: string
  absolutePath: string
  projectId: Workspace["projects"][number]["id"]
  projectRoot: string
}

export interface DiscoveredAnalysisFiles {
  specifications: Array<{ path: string; absolutePath: string }>
  sourceFiles: DiscoveredSourceFile[]
}

/** Finds supported specification and source files while excluding generated/build trees. */
export async function discoverAnalysisFiles(workspace: Workspace, fileSystem: FileSystem): Promise<DiscoveredAnalysisFiles> {
  const specifications: Array<{ path: string; absolutePath: string }> = []
  const specificationRoots = [
    join(workspace.rootPath, ".spec"),
    join(workspace.rootPath, ".specta", "planning"),
  ]
  for (const specificationRoot of specificationRoots) {
    if (await fileSystem.exists(specificationRoot)) {
      for (const absolutePath of await walkFiles(fileSystem, specificationRoot, false)) {
        if (absolutePath.toLowerCase().endsWith(".md")) {
          specifications.push({ path: normalizePath(relative(workspace.rootPath, absolutePath)), absolutePath })
        }
      }
    }
  }

  const sourceByPath = new Map<string, DiscoveredSourceFile>()
  for (const project of [...workspace.projects].sort((a, b) => b.rootPath.length - a.rootPath.length)) {
    const projectAbsoluteRoot = join(workspace.rootPath, project.rootPath)
    for (const absolutePath of await walkFiles(fileSystem, projectAbsoluteRoot, true)) {
      const extension = absolutePath.slice(absolutePath.lastIndexOf(".")).toLowerCase()
      if (!sourceExtensions.has(extension)) continue
      const path = normalizePath(relative(workspace.rootPath, absolutePath))
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
  }
}

async function walkFiles(fileSystem: FileSystem, rootPath: string, ignoreGenerated: boolean): Promise<string[]> {
  const result: string[] = []
  const visit = async (directory: string): Promise<void> => {
    const files = await fileSystem.listFiles(directory)
    for (const file of files.sort()) result.push(join(directory, file))
    const directories = await fileSystem.listDirectories(directory)
    for (const name of directories.sort()) {
      if (ignoreGenerated && (ignoredDirectories.has(name) || name === ".spec")) continue
      await visit(join(directory, name))
    }
  }
  await visit(rootPath)
  return result
}
