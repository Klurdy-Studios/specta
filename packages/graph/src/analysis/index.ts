import {
  workspaceAnalysisSchema,
  planningStateSchema,
  type ParseDiagnostic,
  type Workspace,
  type WorkspaceAnalysis,
} from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { nodeFileSystem } from "@specta/core/filesystem"
import {
  createParserRegistry,
  markdownSpecificationParser,
  type LanguageParser,
  type ModuleResolver,
  type ParserRegistry,
  typeScriptLanguageParser,
} from "../parser/index.ts"
import { discoverAnalysisFiles } from "./discovery.ts"
import { projectWorkspaceAnalysis } from "./projector.ts"
import { analysisGraphSnapshotSchema, type AnalysisGraphSnapshot } from "./snapshot.ts"
import { normalizeGraphTitle } from "./identifiers.ts"
import { createSqliteWorkspaceGraphProvider } from "../persistence/sqlite.ts"
import type { WorkspaceGraphProvider } from "../repository/contracts.ts"
import { analysisProjection } from "../updates/domain-projections.ts"

export * from "./discovery.ts"
export * from "./identifiers.ts"
export * from "./projector.ts"
export * from "./snapshot.ts"

export interface AnalysisGraphRepository {
  load(workspace: Workspace): Promise<AnalysisGraphSnapshot | null>
  save(workspace: Workspace, snapshot: AnalysisGraphSnapshot): Promise<void>
}

export interface WorkspaceAnalyzer {
  /** Recompiles deterministic analysis and incrementally updates its graph projection. */
  compile(workspace: Workspace): Promise<AnalysisGraphSnapshot>
}

export interface WorkspaceAnalyzerOptions {
  fileSystem?: FileSystem
  parsers?: ParserRegistry
  repository?: AnalysisGraphRepository
  graphProvider?: WorkspaceGraphProvider
}

/** Creates validated read/write access to the analysis projection in the Workspace Graph. */
export function createAnalysisGraphRepository(
  fileSystem: FileSystem = nodeFileSystem,
  provider: WorkspaceGraphProvider = createSqliteWorkspaceGraphProvider({ fileSystem }),
): AnalysisGraphRepository {
  return {
    async load(workspace) {
      try {
        return await provider.withGraph(workspace, async (graph) => {
          const value = await graph.readDocument<unknown>("analysis")
          return value === null ? null : analysisGraphSnapshotSchema.parse(value)
        })
      } catch (error) {
        throw new Error("Unable to read source analysis from the Workspace Graph.", { cause: error })
      }
    },
    async save(workspace, snapshot) {
      const validated = analysisGraphSnapshotSchema.parse(snapshot)
      await provider.withGraph(workspace, async (graph) => graph.projections.apply(analysisProjection(validated)))
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
  const graphProvider = options.graphProvider ?? createSqliteWorkspaceGraphProvider({ fileSystem })
  const repository = options.repository ?? createAnalysisGraphRepository(fileSystem, graphProvider)
  return {
    async compile(workspace) {
      const discovered = await discoverAnalysisFiles(workspace, fileSystem, parsers)
      const specifications = []
      const sourceFiles = []
      const diagnostics: ParseDiagnostic[] = []

      const specificationContents = await readFiles(
        discovered.specifications.map((file) => file.absolutePath),
        fileSystem,
      )
      for (const [index, file] of discovered.specifications.entries()) {
        const parser = parsers.specificationParser(file.path)
        if (!parser) continue
        const parsed = parser.parse({ path: file.path, content: specificationContents[index] ?? "" })
        specifications.push(parsed)
        diagnostics.push(...parsed.diagnostics)
      }
      const sourceContents = await readFiles(discovered.sourceFiles.map((file) => file.absolutePath), fileSystem)
      for (const [index, file] of discovered.sourceFiles.entries()) {
        const parser = parsers.languageParser(file.path)
        if (!parser) continue
        const parsed = parser.parse({
          path: file.path,
          content: sourceContents[index] ?? "",
          projectId: file.projectId,
        })
        sourceFiles.push(parsed)
        diagnostics.push(...parsed.diagnostics)
      }

      const knownPaths = new Set(discovered.workspaceFiles)
      const resolvers = new Map<LanguageParser, ModuleResolver | undefined>()
      for (const file of sourceFiles) {
        const parser = parsers.languageParser(file.path)
        if (!parser) continue
        if (!resolvers.has(parser)) {
          resolvers.set(parser, parser.createModuleResolver
            ? await parser.createModuleResolver({ workspace, fileSystem, knownPaths })
            : undefined)
        }
        const resolver = resolvers.get(parser)
        for (const imported of file.imports) {
          const resolution = resolver?.resolve({
            importingPath: file.path,
            specifier: imported.specifier,
            ...(file.projectId ? { projectId: file.projectId } : {}),
          }) ?? { kind: "unresolved" as const, specifier: imported.specifier }
          imported.resolution = resolution
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
      const canonicalPlanningIds = await loadCanonicalPlanningIds(workspace, graphProvider)
      const snapshot = projectWorkspaceAnalysis(analysis, projectRoots, canonicalPlanningIds)
      await repository.save(workspace, snapshot)
      return snapshot
    },
  }
}

async function readFiles(paths: string[], fileSystem: FileSystem): Promise<string[]> {
  const contents: string[] = []
  const concurrency = 32
  for (let index = 0; index < paths.length; index += concurrency) {
    contents.push(...await Promise.all(paths.slice(index, index + concurrency).map((path) => fileSystem.readText(path))))
  }
  return contents
}

async function loadCanonicalPlanningIds(workspace: Workspace, provider: WorkspaceGraphProvider): Promise<Map<string, string>> {
  try {
    const value = await provider.withGraph(workspace, (graph) => graph.readDocument<unknown>("planning-state"))
    const state = planningStateSchema.safeParse(value)
    if (!state.success) return new Map()
    const result = new Map<string, string>()
    for (const epic of state.data.epics ?? []) {
      result.set(planningEntityKey("epic", epic.title), epic.id)
      for (const story of epic.stories) {
        result.set(planningEntityKey("story", story.title, epic.title), story.id)
        for (const criterion of story.acceptanceCriteria) {
          result.set(planningEntityKey("acceptance-criterion", criterion.description, story.title), criterion.id)
        }
        for (const task of story.tasks) result.set(planningEntityKey("task", task.title, story.title), task.id)
      }
    }
    return result
  } catch {
    return new Map()
  }
}

function planningEntityKey(kind: string, title: string, parentTitle?: string): string {
  return kind + ":" + normalizeGraphTitle(title) + (parentTitle ? "|parent:" + normalizeGraphTitle(parentTitle) : "")
}

function compareDiagnostics(left: ParseDiagnostic, right: ParseDiagnostic): number {
  return (left.location?.path ?? "").localeCompare(right.location?.path ?? "")
    || (left.location?.start.line ?? 0) - (right.location?.start.line ?? 0)
    || left.code.localeCompare(right.code)
}
