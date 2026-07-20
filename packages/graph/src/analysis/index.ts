import { join } from "node:path"
import {
  workspaceAnalysisSchema,
  type ParseDiagnostic,
  type Workspace,
  type WorkspaceAnalysis,
} from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { nodeFileSystem } from "@specta/core/filesystem"
import {
  createParserRegistry,
  markdownSpecificationParser,
  type ParserRegistry,
  typeScriptLanguageParser,
} from "../parser/index.ts"
import { discoverAnalysisFiles } from "./discovery.ts"
import { projectWorkspaceAnalysis } from "./projector.ts"
import { resolveTypeScriptModule } from "./resolver.ts"
import { analysisGraphSnapshotSchema, type AnalysisGraphSnapshot } from "./snapshot.ts"

export * from "./discovery.ts"
export * from "./identifiers.ts"
export * from "./projector.ts"
export * from "./resolver.ts"
export * from "./snapshot.ts"

export interface AnalysisGraphRepository {
  load(workspace: Workspace): Promise<AnalysisGraphSnapshot | null>
  save(workspace: Workspace, snapshot: AnalysisGraphSnapshot): Promise<void>
}

export interface WorkspaceAnalyzer {
  /** Performs a full deterministic rebuild and persists the analysis graph shard. */
  compile(workspace: Workspace): Promise<AnalysisGraphSnapshot>
}

export interface WorkspaceAnalyzerOptions {
  fileSystem?: FileSystem
  parsers?: ParserRegistry
  repository?: AnalysisGraphRepository
}

/** Creates the repository for `.specta/graph/analysis.json`. */
export function createAnalysisGraphRepository(fileSystem: FileSystem = nodeFileSystem): AnalysisGraphRepository {
  const pathFor = (workspace: Workspace): string => join(workspace.rootPath, ".specta", "graph", "analysis.json")
  return {
    async load(workspace) {
      const path = pathFor(workspace)
      if (!(await fileSystem.exists(path))) return null
      try {
        return analysisGraphSnapshotSchema.parse(JSON.parse(await fileSystem.readText(path)))
      } catch (error) {
        throw new Error("Unable to read source analysis from the Workspace Graph.", { cause: error })
      }
    },
    async save(workspace, snapshot) {
      const path = pathFor(workspace)
      const content = JSON.stringify(analysisGraphSnapshotSchema.parse(snapshot), null, 2) + "\n"
      if (!(await fileSystem.exists(path)) || await fileSystem.readText(path) !== content) {
        await fileSystem.writeText(path, content)
      }
    },
  }
}

/** Creates the language-independent orchestration service for specification and code analysis. */
export function createWorkspaceAnalyzer(options: WorkspaceAnalyzerOptions = {}): WorkspaceAnalyzer {
  const fileSystem = options.fileSystem ?? nodeFileSystem
  const parsers = options.parsers ?? createParserRegistry({
    specificationParsers: [markdownSpecificationParser],
    languageParsers: [typeScriptLanguageParser],
  })
  const repository = options.repository ?? createAnalysisGraphRepository(fileSystem)
  return {
    async compile(workspace) {
      const discovered = await discoverAnalysisFiles(workspace, fileSystem)
      const specifications = []
      const sourceFiles = []
      const diagnostics: ParseDiagnostic[] = []

      for (const file of discovered.specifications) {
        const parser = parsers.specificationParser(file.path)
        if (!parser) continue
        const result = parser.parse({ path: file.path, content: await fileSystem.readText(file.absolutePath) })
        specifications.push(result.value)
        diagnostics.push(...result.diagnostics)
      }
      for (const file of discovered.sourceFiles) {
        const parser = parsers.languageParser(file.path)
        if (!parser) continue
        const result = parser.parse({
          path: file.path,
          content: await fileSystem.readText(file.absolutePath),
          projectId: file.projectId,
        })
        sourceFiles.push(result.value)
        diagnostics.push(...result.diagnostics)
      }

      const knownPaths = new Set(sourceFiles.map((file) => file.path))
      for (const file of sourceFiles) {
        for (const imported of file.imports) {
          const resolution = resolveTypeScriptModule(file.path, imported.specifier, knownPaths)
          if (resolution.kind === "unresolved") {
            diagnostics.push({
              code: "MODULE_NOT_FOUND",
              severity: "warning",
              message: "Unable to resolve " + imported.specifier + " from " + file.path + ".",
              location: imported.location,
            })
          }
        }
      }

      const analysis: WorkspaceAnalysis = workspaceAnalysisSchema.parse({
        schemaVersion: 1,
        specifications,
        sourceFiles,
        diagnostics: diagnostics.sort(compareDiagnostics),
      })
      const projectRoots = new Map(workspace.projects.map((project) => [project.id, project.rootPath]))
      const snapshot = projectWorkspaceAnalysis(analysis, projectRoots)
      await repository.save(workspace, snapshot)
      return snapshot
    },
  }
}

function compareDiagnostics(left: ParseDiagnostic, right: ParseDiagnostic): number {
  return (left.location?.path ?? "").localeCompare(right.location?.path ?? "")
    || (left.location?.start.line ?? 0) - (right.location?.start.line ?? 0)
    || left.code.localeCompare(right.code)
}

