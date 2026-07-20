import type { WorkspaceAnalysis } from "@specta/core"
import { posix } from "node:path"
import type { AnalysisGraphNode, AnalysisGraphRelationship, AnalysisGraphSnapshot } from "./snapshot.ts"
import { analysisGraphSnapshotSchema } from "./snapshot.ts"
import { createStableGraphId } from "./identifiers.ts"
import { resolveTypeScriptModule } from "./resolver.ts"

const entityNodeTypes = {
  requirement: "REQUIREMENT",
  "architecture-decision": "ARCHITECTURE_DECISION",
  epic: "EPIC",
  story: "STORY",
  "acceptance-criterion": "ACCEPTANCE_CRITERION",
  task: "TASK",
} as const

/** Projects parser output into a deterministic, serializable Workspace Graph shard. */
export function projectWorkspaceAnalysis(
  analysis: WorkspaceAnalysis,
  projectRoots: ReadonlyMap<string, string>,
): AnalysisGraphSnapshot {
  const nodes: AnalysisGraphNode[] = []
  const relationships: AnalysisGraphRelationship[] = []
  const fileIds = new Map<string, string>()
  const knownPaths = new Set(analysis.sourceFiles.map((file) => file.path))

  for (const specification of analysis.specifications) {
    const documentId = createStableGraphId("specification", ".", specification.path)
    nodes.push({ id: documentId, type: "SPECIFICATION_DOCUMENT", path: specification.path, ...(specification.title ? { name: specification.title } : {}) })
    const entityIdsByTitle = new Map<string, string>()
    for (const [index, entity] of specification.entities.entries()) {
      const id = createStableGraphId(entity.kind, ".", specification.path + "#" + entity.title + ":" + index)
      entityIdsByTitle.set(entity.title, id)
      nodes.push({ id, type: entityNodeTypes[entity.kind], name: entity.title, path: specification.path, kind: entity.kind })
      const parentId = entity.parentTitle ? entityIdsByTitle.get(entity.parentTitle) : undefined
      relationships.push({ type: "CONTAINS", sourceId: parentId ?? documentId, targetId: id })
    }
  }

  for (const file of analysis.sourceFiles) {
    const projectRoot = file.projectId ? projectRoots.get(file.projectId) ?? "." : "."
    const projectPath = projectRelativePath(projectRoot, file.path)
    const fileId = createStableGraphId("file", projectRoot, projectPath)
    fileIds.set(file.path, fileId)
    nodes.push({ id: fileId, type: "FILE", path: file.path, ...(file.projectId ? { projectId: file.projectId } : {}) })
    const symbolIds = new Map<string, string>()
    for (const symbol of file.symbols) {
      const symbolId = createStableGraphId("symbol", projectRoot, projectPath + "#" + symbol.name)
      symbolIds.set(symbol.name, symbolId)
      nodes.push({ id: symbolId, type: "CODE_SYMBOL", path: file.path, name: symbol.name, kind: symbol.kind, ...(symbol.signature ? { signature: symbol.signature } : {}) })
      relationships.push({ type: "CONTAINS", sourceId: fileId, targetId: symbolId })
    }
    for (const exported of file.exports) {
      const symbolId = symbolIds.get(exported.name)
      if (symbolId) relationships.push({ type: "EXPORTS", sourceId: fileId, targetId: symbolId })
    }
    for (const [index, test] of file.tests.entries()) {
      const testId = createStableGraphId("test", projectRoot, projectPath + "#" + test.name + ":" + index)
      nodes.push({ id: testId, type: "TEST", path: file.path, name: test.name, kind: test.framework })
      relationships.push({ type: "CONTAINS", sourceId: fileId, targetId: testId })
      for (const testedSymbol of test.testedSymbols) {
        const targetId = symbolIds.get(testedSymbol)
        if (targetId) relationships.push({ type: "TESTS", sourceId: testId, targetId })
      }
    }
  }

  const externalIds = new Map<string, string>()
  for (const file of analysis.sourceFiles) {
    const sourceId = fileIds.get(file.path)
    if (!sourceId) continue
    for (const imported of file.imports) {
      const resolution = resolveTypeScriptModule(file.path, imported.specifier, knownPaths)
      if (resolution.kind === "workspace-file") {
        const targetId = fileIds.get(resolution.path)
        if (targetId) relationships.push({ type: "IMPORTS", sourceId, targetId })
      } else if (resolution.kind === "external") {
        let targetId = externalIds.get(resolution.packageName)
        if (!targetId) {
          targetId = createStableGraphId("dependency", ".", resolution.packageName)
          externalIds.set(resolution.packageName, targetId)
          nodes.push({ id: targetId, type: "EXTERNAL_DEPENDENCY", name: resolution.packageName })
        }
        relationships.push({ type: "IMPORTS", sourceId, targetId })
      }
    }
  }

  return analysisGraphSnapshotSchema.parse({
    schemaVersion: 1,
    analysis,
    nodes: uniqueSorted(nodes, (node) => node.id),
    relationships: uniqueSorted(relationships, (relationship) => [relationship.type, relationship.sourceId, relationship.targetId].join(":")),
  })
}

function uniqueSorted<T>(values: T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()].sort((a, b) => key(a).localeCompare(key(b)))
}

function projectRelativePath(projectRoot: string, workspacePath: string): string {
  return projectRoot === "." ? workspacePath : posix.relative(projectRoot, workspacePath)
}
