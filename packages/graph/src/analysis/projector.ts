import { posix } from "node:path"
import type { ProjectId, WorkspaceAnalysis } from "@specta/core"
import type { AnalysisGraphNode, AnalysisGraphRelationship, AnalysisGraphSnapshot } from "./snapshot.ts"
import { analysisGraphSnapshotSchema } from "./snapshot.ts"
import { createStableGraphId, normalizeGraphTitle } from "./identifiers.ts"

/** Projects parser output into a deterministic, serializable Workspace Graph shard. */
export function projectWorkspaceAnalysis(
  analysis: WorkspaceAnalysis,
  projectRoots: ReadonlyMap<ProjectId, string>,
  canonicalPlanningIds: ReadonlyMap<string, string> = new Map(),
): AnalysisGraphSnapshot {
  const nodes: AnalysisGraphNode[] = []
  const relationships: AnalysisGraphRelationship[] = []
  const fileIds = new Map<string, string>()
  const symbolsByFile = new Map<string, Map<string, string>>()
  const exportsByFile = new Map<string, Map<string, string>>()

  for (const specification of analysis.specifications) {
    const documentId = createStableGraphId("specification", ".", specification.path)
    nodes.push({ id: documentId, type: "SPECIFICATION_DOCUMENT", path: specification.path, ...(specification.title ? { title: specification.title } : {}) })
    const occurrences = new Map<string, number>()
    const entityIdsByKindAndTitle = new Map<string, string>()
    for (const entity of specification.entities) {
      const semanticKey = entitySemanticKey(entity.kind, entity.title, entity.parentTitle)
      const occurrence = (occurrences.get(semanticKey) ?? 0) + 1
      occurrences.set(semanticKey, occurrence)
      const identity = specification.path + "#" + semanticKey + (occurrence === 1 ? "" : ":" + occurrence)
      const id = createStableGraphId("specification-entity", ".", identity)
      nodes.push({ id, type: "SPECIFICATION_ENTITY", title: entity.title, path: specification.path, entityKind: entity.kind })
      const parentKind = entity.kind === "story" ? "epic"
        : entity.kind === "task" || entity.kind === "acceptance-criterion" ? "story"
        : undefined
      const parentId = parentKind && entity.parentTitle
        ? entityIdsByKindAndTitle.get(parentKind + ":" + normalizeGraphTitle(entity.parentTitle))
        : undefined
      relationships.push({ type: "CONTAINS", sourceId: parentId ?? documentId, targetId: id })
      entityIdsByKindAndTitle.set(entity.kind + ":" + normalizeGraphTitle(entity.title), id)
      const canonicalId = canonicalPlanningIds.get(semanticKey)
      if (canonicalId) relationships.push({ type: "REFERENCES", sourceId: id, targetId: canonicalId })
    }
  }

  for (const file of analysis.sourceFiles) {
    const projectRoot = file.projectId ? projectRoots.get(file.projectId) ?? "." : "."
    const projectPath = projectRelativePath(projectRoot, file.path)
    const fileId = createStableGraphId("file", projectRoot, projectPath)
    fileIds.set(file.path, fileId)
    nodes.push({
      id: fileId,
      type: "FILE",
      path: file.path,
      fileKind: inferFileKind(file.path),
      ...(file.projectId ? { projectId: file.projectId } : {}),
    })
    const symbolIds = new Map<string, string>()
    symbolsByFile.set(file.path, symbolIds)
    for (const symbol of file.symbols) {
      const symbolId = createStableGraphId("symbol", projectRoot, projectPath + "#" + symbol.name)
      symbolIds.set(symbol.name, symbolId)
      nodes.push({
        id: symbolId,
        type: "CODE_SYMBOL",
        path: file.path,
        name: symbol.name,
        symbolKind: symbol.kind,
        ...(symbol.signature ? { signature: symbol.signature } : {}),
      })
      relationships.push({ type: "CONTAINS", sourceId: fileId, targetId: symbolId })
    }
  }

  for (const file of analysis.sourceFiles) {
    const exportedSymbols = new Map<string, string>()
    exportsByFile.set(file.path, exportedSymbols)
    const localSymbols = symbolsByFile.get(file.path) ?? new Map()
    for (const exported of file.exports) {
      const target = localSymbols.get(exported.localName ?? exported.name)
      if (target) exportedSymbols.set(exported.name, target)
    }
  }
  for (let iteration = 0; iteration < analysis.sourceFiles.length; iteration += 1) {
    let changed = false
    for (const file of analysis.sourceFiles) {
      const exportedSymbols = exportsByFile.get(file.path) ?? new Map()
      for (const exported of file.exports) {
        if (exportedSymbols.has(exported.name) || !exported.source) continue
        const imported = file.imports.find((candidate) => candidate.specifier === exported.source)
        if (imported?.resolution?.kind !== "workspace-file") continue
        const target = exportsByFile.get(imported.resolution.path)?.get(exported.localName ?? exported.name)
        if (target) {
          exportedSymbols.set(exported.name, target)
          changed = true
        }
      }
    }
    if (!changed) break
  }

  const assetIds = new Map<string, string>()
  const externalIds = new Map<string, string>()
  for (const file of analysis.sourceFiles) {
    const sourceId = fileIds.get(file.path)
    if (!sourceId) continue
    const localSymbols = symbolsByFile.get(file.path) ?? new Map()
    for (const exported of file.exports) {
      const symbolId = exportsByFile.get(file.path)?.get(exported.name)
      if (symbolId) relationships.push({ type: "EXPORTS", sourceId, targetId: symbolId })
    }
    for (const imported of file.imports) {
      const resolution = imported.resolution
      if (resolution?.kind === "workspace-file") {
        const targetId = fileIds.get(resolution.path) ?? ensureAssetNode(resolution.path, projectRoots, nodes, assetIds)
        relationships.push({ type: "IMPORTS", sourceId, targetId })
        const mappings = imported.bindingMappings ?? imported.bindings.map((binding) => ({ imported: binding, local: binding }))
        for (const binding of mappings) {
          const targetSymbol = binding.imported === "*" ? undefined : exportsByFile.get(resolution.path)?.get(binding.imported)
          if (targetSymbol) relationships.push({ type: "REFERENCES", sourceId, targetId: targetSymbol })
        }
      } else if (resolution?.kind === "external") {
        let targetId = externalIds.get(resolution.packageName)
        if (!targetId) {
          targetId = createStableGraphId("dependency", ".", resolution.packageName)
          externalIds.set(resolution.packageName, targetId)
          nodes.push({ id: targetId, type: "EXTERNAL_DEPENDENCY", name: resolution.packageName })
        }
        relationships.push({ type: "IMPORTS", sourceId, targetId })
      }
    }
    for (const [index, test] of file.tests.entries()) {
      const projectRoot = file.projectId ? projectRoots.get(file.projectId) ?? "." : "."
      const testId = createStableGraphId("test", projectRoot, projectRelativePath(projectRoot, file.path) + "#" + test.name + ":" + index)
      nodes.push({ id: testId, type: "TEST", path: file.path, name: test.name, framework: test.framework })
      relationships.push({ type: "CONTAINS", sourceId, targetId: testId })
      for (const testedSymbol of test.testedSymbols) {
        const localTarget = localSymbols.get(testedSymbol)
        if (localTarget) relationships.push({ type: "TESTS", sourceId: testId, targetId: localTarget })
        for (const imported of file.imports) {
          if (imported.resolution?.kind !== "workspace-file") continue
          const mapping = (imported.bindingMappings ?? imported.bindings.map((binding) => ({ imported: binding, local: binding })))
            .find((binding) => binding.local === testedSymbol)
          if (!mapping || mapping.imported === "*") continue
          const importedTarget = exportsByFile.get(imported.resolution.path)?.get(mapping.imported)
          if (importedTarget) relationships.push({ type: "TESTS", sourceId: testId, targetId: importedTarget })
        }
      }
    }
  }

  return analysisGraphSnapshotSchema.parse({
    schemaVersion: 2,
    analysis,
    nodes: uniqueSorted(nodes, (node) => node.id),
    relationships: uniqueSorted(relationships, (relationship) => [relationship.type, relationship.sourceId, relationship.targetId].join(":")),
  })
}

function entitySemanticKey(kind: string, title: string, parentTitle?: string): string {
  return kind + ":" + normalizeGraphTitle(title) + (parentTitle ? "|parent:" + normalizeGraphTitle(parentTitle) : "")
}

function ensureAssetNode(
  path: string,
  projectRoots: ReadonlyMap<ProjectId, string>,
  nodes: AnalysisGraphNode[],
  assetIds: Map<string, string>,
): string {
  const existing = assetIds.get(path)
  if (existing) return existing
  const owner = [...projectRoots.entries()]
    .filter(([, root]) => root === "." || path === root || path.startsWith(root + "/"))
    .sort((left, right) => right[1].length - left[1].length)[0]
  const projectId = owner?.[0]
  const projectRoot = owner?.[1] ?? "."
  const id = createStableGraphId("file", projectRoot, projectRelativePath(projectRoot, path))
  assetIds.set(path, id)
  nodes.push({ id, type: "FILE", path, fileKind: "asset", ...(projectId ? { projectId } : {}) })
  return id
}

function inferFileKind(path: string): "source" | "test" | "configuration" {
  if (/(?:^|\/)(?:[^/]+\.)?(?:test|spec)\.[cm]?[jt]sx?$/.test(path)) return "test"
  if (/(?:^|\/)(?:[^/]+\.config\.[cm]?[jt]s|tsconfig[^/]*\.json)$/.test(path)) return "configuration"
  return "source"
}

function uniqueSorted<T>(values: T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()].sort((a, b) => key(a).localeCompare(key(b)))
}

function projectRelativePath(projectRoot: string, workspacePath: string): string {
  return projectRoot === "." ? workspacePath : posix.relative(projectRoot, workspacePath)
}
