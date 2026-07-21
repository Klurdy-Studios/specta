import { createHash } from "node:crypto"
import {
  planningStateSchema,
  technicalDesignSchema,
  workflowRunSchema,
  type TechnicalDesign,
} from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { nodeFileSystem } from "@specta/core/filesystem"
import { z } from "zod"
import { createFileGraphId, createModuleGraphId, createSymbolGraphId } from "../analysis/identifiers.ts"
import { analysisGraphSnapshotSchema } from "../analysis/snapshot.ts"
import { createSqliteWorkspaceGraphProvider } from "../persistence/sqlite.ts"
import type {
  GraphNeighborRecord,
  GraphNodeRecord,
  WorkspaceGraphEdgeKind,
  WorkspaceGraphProvider,
  WorkspaceGraphQueries,
} from "../repository/contracts.ts"
import { estimateContextTokens, selectContextCandidates, type ContextCandidate } from "./budget.ts"
import {
  contextPacketSchema,
  contextRequestSchema,
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  type ContextDependency,
  type ContextEngine,
  type ContextImpact,
  type ContextPacket,
  type ContextPacketRepository,
  type ContextSourceFile,
  type ContextSymbol,
  type ContextTest,
} from "./contracts.ts"
import { createContextPacketRepository } from "./repository.ts"
import { renderContextPacket } from "./render.ts"

export interface ContextEngineOptions {
  fileSystem?: FileSystem
  graphProvider?: WorkspaceGraphProvider
  repository?: ContextPacketRepository
}

type TaggedContextCandidate =
  | { type: "file", item: ContextSourceFile }
  | { type: "symbol", item: ContextSymbol }
  | { type: "dependency", item: ContextDependency }

type ContextPacketContent = Omit<
  ContextPacket,
  "sourceFingerprint" | "relevantNodeIds" | "tokenUsage" | "diagnostics"
>

const MAX_IMPACTS_PER_SECTION = 50

/** Creates the deterministic Context Engine used by agent-oriented workflows. */
export function createContextEngine(options: ContextEngineOptions = {}): ContextEngine {
  const fileSystem = options.fileSystem ?? nodeFileSystem
  const provider = options.graphProvider ?? createSqliteWorkspaceGraphProvider({ fileSystem })
  const repository = options.repository ?? createContextPacketRepository(fileSystem, provider)
  return {
    async compile(workspace, requestValue) {
      const request = contextRequestSchema.parse(requestValue)
      if (request.implementationRunId) {
        const persisted = await repository.get(workspace, request.implementationRunId)
        if (persisted) {
          if (persisted.epicId !== request.epicId) {
            throw new Error("Implementation Run context targets a different Epic.")
          }
          return persisted
        }
      }
      const packet = await provider.withGraph(workspace, async (graph) => {
        if (request.implementationRunId) {
          const runValue = await graph.readDocument<unknown>("workflow-run:" + request.implementationRunId)
          if (runValue === null) throw new Error("Implementation Run not found: " + request.implementationRunId + ".")
          const run = workflowRunSchema.parse(runValue)
          if (run.workflow !== "implement" || run.targetKind !== "epic" || run.targetId !== request.epicId) {
            throw new Error("Context request and Implementation Run must target the same Epic.")
          }
        }
        const planningValue = await graph.readDocument<unknown>("planning-state")
        if (planningValue === null) throw new Error("Compile planning before requesting implementation context.")
        const planning = planningStateSchema.parse(planningValue)
        const epic = planning.epics?.find((candidate) => candidate.id === request.epicId)
        if (!epic) throw new Error("Epic not found in the Workspace Graph: " + request.epicId + ".")
        if (!planning.architecture || !planning.constitution) {
          throw new Error("Epic implementation context requires Architecture and Constitution planning stages.")
        }
        const designValue = await graph.readDocument<unknown>("technical-designs")
        const designs = designValue === null ? [] : z.array(technicalDesignSchema).parse(designValue)
        const analysis = analysisGraphSnapshotSchema.safeParse(await graph.readDocument<unknown>("analysis"))
        const hasSourceAnalysis = analysis.success && analysis.data.analysis.sourceFiles.length > 0
        const design = latestApprovedDesign(designs, epic.id)
        if (!design) throw new Error("Epic implementation context requires an approved Technical Design.")

        const implementationStates = new Map(
          (await graph.queries.listNodes("EpicImplementationState"))
            .map((state) => [String(state.props.epicId), String(state.props.status)]),
        )
        const requiredNodeIds = new Set<string>([
          epic.id,
          planning.architecture.id,
          planning.constitution.id,
          design.id,
          ...epic.stories.flatMap((story) => [
            story.id,
            ...story.acceptanceCriteria.map((criterion) => criterion.id),
            ...story.tasks.map((task) => task.id),
          ]),
        ])
        const designFiles: Array<{
          nodeId: string
          path: string
          kind: string
          relevance: ContextSourceFile["relevance"]
          score: number
        }> = []
        const designSymbols: Array<{
          nodeId: string
          path: string
          symbol: TechnicalDesign["modules"][number]["files"][number]["exports"][number]
          score: number
        }> = []
        for (const module of design.modules) {
          requiredNodeIds.add(createModuleGraphId(design.profile.rootPath, module.path))
          for (const file of module.files) {
            const fileId = createFileGraphId(design.profile.rootPath, file.path)
            designFiles.push({ nodeId: fileId, path: file.path, kind: file.kind, relevance: "designed", score: 100 })
            requiredNodeIds.add(fileId)
            for (const symbol of file.exports) {
              const symbolId = createSymbolGraphId(design.profile.rootPath, file.path, symbol.name)
              designSymbols.push({ nodeId: symbolId, path: file.path, symbol, score: 95 })
              requiredNodeIds.add(symbolId)
            }
          }
        }

        const dependencyContext = collectDependencyContext(design, designs, planning, implementationStates)
        for (const id of dependencyContext.nodeIds) requiredNodeIds.add(id)
        const allRequiredIds = [
          ...designFiles.map((file) => file.nodeId),
          ...designSymbols.map((symbol) => symbol.nodeId),
          ...dependencyContext.files.map((file) => file.nodeId),
          ...dependencyContext.symbols.map((symbol) => symbol.nodeId),
        ]
        const requiredGraphNodes = new Map((await Promise.all([...new Set(allRequiredIds)].map(async (id) =>
          [id, await graph.queries.getNode(id)] as const,
        ))).filter((entry): entry is readonly [string, GraphNodeRecord] => entry[1] !== null))
        const requiredFiles = [...designFiles, ...dependencyContext.files].map((file) => sourceFile(
          requiredGraphNodes.get(file.nodeId) ?? null,
          file.nodeId,
          file.path,
          file.kind,
          file.relevance,
          file.score,
        ))
        const requiredSymbols = [...designSymbols, ...dependencyContext.symbols].map((symbol) => contextSymbol(
          requiredGraphNodes.get(symbol.nodeId) ?? null,
          symbol.nodeId,
          symbol.path,
          symbol.symbol,
          symbol.score,
        ))
        const requiredDependencies = dependencyContext.dependencies
        const designFileIds = designFiles.map((file) => file.nodeId)
        const designSymbolIds = designSymbols.map((symbol) => symbol.nodeId)

        const sourceCandidates: ContextCandidate<ContextSourceFile>[] = []
        const symbolCandidates: ContextCandidate<ContextSymbol>[] = []
        const dependencyCandidates: ContextCandidate<ContextDependency>[] = []
        const testsById = new Map<string, ContextTest>()
        const testFileIds = new Set<string>()
        const seedIds = [...designFileIds, ...designSymbolIds]
        const outgoingGroups = hasSourceAnalysis ? await Promise.all(designFileIds.map((nodeId) => graph.queries.searchNeighbors({
          nodeId,
          direction: "outgoing",
          edgeKinds: ["IMPORTS", "REFERENCES"],
          depth: 1,
        }))) : []
        for (const node of outgoingGroups.flat()) {
          if (requiredNodeIds.has(node.id)) continue
          if (node.kind === "File") {
            sourceCandidates.push({
              key: node.id,
              score: 65,
              value: sourceFile(node, node.id, String(node.props.path), parseFileKind(node.props.fileKind), "dependency", 65),
            })
          } else if (node.kind === "CodeSymbol") {
            symbolCandidates.push({ key: node.id, score: 75, value: graphSymbol(node, 75) })
          } else if (node.kind === "ExternalDependency") {
            dependencyCandidates.push({
              key: node.id,
              score: 55,
              value: { nodeId: node.id, kind: "external", label: String(node.props.name), required: false },
            })
          }
        }
        const incomingGroups = hasSourceAnalysis ? await Promise.all(seedIds.map((nodeId) => graph.queries.searchNeighbors({
          nodeId,
          direction: "incoming",
          edgeKinds: ["IMPORTS", "REFERENCES", "TESTS"],
          depth: 1,
        }))) : []
        for (const node of incomingGroups.flat()) {
          if (node.kind === "File" && parseFileKind(node.props.fileKind) === "test") {
            sourceCandidates.push({
              key: node.id,
              score: 85,
              value: sourceFile(node, node.id, String(node.props.path), "test", "test", 85),
            })
            testFileIds.add(node.id)
          } else if (node.kind === "Test") {
            testsById.set(node.id, graphTest(node, 90))
          }
        }
        const testContents = await Promise.all([...testFileIds].map((nodeId) =>
          graph.queries.searchNeighbors({
            nodeId,
            direction: "outgoing",
            edgeKinds: ["CONTAINS", "IMPORTS"],
            depth: 1,
          }),
        ))
        for (const nodes of testContents) {
          for (const node of nodes) {
            if (node.kind === "Test") testsById.set(node.id, graphTest(node, 88))
            else if (node.kind === "ExternalDependency") {
              dependencyCandidates.push({
                key: node.id,
                score: 50,
                value: { nodeId: node.id, kind: "external", label: String(node.props.name), required: false },
              })
            }
          }
        }

        const requiredTests = [...testsById.values()].sort(comparePathThenId)
        for (const test of requiredTests) requiredNodeIds.add(test.nodeId)
        const blastRadius = await compileBlastRadius(
          graph.queries,
          epic.id,
          design.id,
          designFileIds,
          designSymbolIds,
          requiredTests,
          {
            sourceAnalysis: hasSourceAnalysis,
            dependentEpics: (planning.epics?.length ?? 0) > 1,
            dependentDesigns: designs.length > 1,
          },
        )
        const base = {
          schemaVersion: 1 as const,
          key: request.implementationRunId ? "implementation-run:" + request.implementationRunId : "epic:" + epic.id,
          workflow: "implement" as const,
          epicId: epic.id,
          ...(request.implementationRunId ? { implementationRunId: request.implementationRunId } : {}),
          epic: { id: epic.id, title: epic.title, goal: epic.goal },
          stories: epic.stories.map((story) => ({
            id: story.id,
            title: story.title,
            description: story.description,
            acceptanceCriteria: story.acceptanceCriteria.map((criterion) => ({ id: criterion.id, description: criterion.description })),
            tasks: story.tasks.map((task) => ({ id: task.id, title: task.title, description: task.description })),
          })),
          architecture: {
            overview: planning.architecture.overview,
            components: planning.architecture.components,
            ...(planning.architecture.guidance ? { guidance: planning.architecture.guidance } : {}),
            principles: planning.constitution.principles,
          },
          technicalDesign: {
            id: design.id,
            revision: design.revision,
            status: design.status as "approved" | "scaffolded",
            summary: design.summary,
            targetRootPath: design.profile.rootPath,
            modules: design.modules.map((module) => ({
              name: module.name,
              path: module.path,
              purpose: module.purpose,
              files: module.files.map((file) => ({
                path: file.path,
                kind: file.kind,
                ownership: file.ownership,
                exports: file.exports.map((symbol) => ({
                  name: symbol.name,
                  kind: symbol.kind,
                  purpose: symbol.purpose,
                  ...(symbol.signature ? { signature: symbol.signature } : {}),
                })),
              })),
            })),
          },
          blastRadius,
        }
        const maxTokens = request.maxTokens ?? DEFAULT_CONTEXT_TOKEN_BUDGET
        const requiredContent = {
          ...base,
          dependencies: requiredDependencies,
          sourceFiles: uniqueBy(requiredFiles, (file) => file.nodeId).sort(comparePathThenId),
          symbols: uniqueBy(requiredSymbols, (symbol) => symbol.nodeId).sort(comparePathThenId),
          tests: requiredTests,
        }
        const taggedCandidates: ContextCandidate<TaggedContextCandidate>[] = [
          ...sourceCandidates.map((candidate) => ({ ...candidate, value: { type: "file" as const, item: candidate.value } })),
          ...symbolCandidates.map((candidate) => ({ ...candidate, value: { type: "symbol" as const, item: candidate.value } })),
          ...dependencyCandidates.map((candidate) => ({ ...candidate, value: { type: "dependency" as const, item: candidate.value } })),
        ]
        const allCandidateMaterial = contextMaterial(requiredContent, taggedCandidates)
        const allCandidateIds = contextNodeIds(requiredNodeIds, allCandidateMaterial)
        const candidateEstimate = createMeasuredPacket(
          allCandidateMaterial,
          allCandidateIds,
          maxTokens,
          0,
          false,
        ).tokenUsage.estimated
        const requiredPacket = createMeasuredPacket(requiredContent, requiredNodeIds, maxTokens, candidateEstimate)
        let selected = selectContextCandidates(taggedCandidates, requiredPacket.tokenUsage.estimated, maxTokens)
        let selectedMaterial = contextMaterial(requiredContent, selected)
        let selectedIds = contextNodeIds(requiredNodeIds, selectedMaterial)
        let packet = createMeasuredPacket(selectedMaterial, selectedIds, maxTokens, candidateEstimate)
        while (packet.tokenUsage.overBudget && requiredPacket.tokenUsage.estimated <= maxTokens && selected.length > 0) {
          selected = selected.slice(0, -1)
          selectedMaterial = contextMaterial(requiredContent, selected)
          selectedIds = contextNodeIds(requiredNodeIds, selectedMaterial)
          packet = createMeasuredPacket(selectedMaterial, selectedIds, maxTokens, candidateEstimate)
        }
        return packet
      })
      return request.implementationRunId ? repository.save(workspace, packet) : packet
    },
  }
}

function contextMaterial(
  required: ContextPacketContent,
  selected: ContextCandidate<TaggedContextCandidate>[],
): ContextPacketContent {
  const selectedFiles = selected.flatMap((item) => item.value.type === "file" ? [item.value.item] : [])
  const selectedSymbols = selected.flatMap((item) => item.value.type === "symbol" ? [item.value.item] : [])
  const selectedDependencies = selected.flatMap((item) => item.value.type === "dependency" ? [item.value.item] : [])
  return {
    ...required,
    sourceFiles: uniqueBy([...required.sourceFiles, ...selectedFiles], (file) => file.nodeId).sort(comparePathThenId),
    symbols: uniqueBy([...required.symbols, ...selectedSymbols], (symbol) => symbol.nodeId).sort(comparePathThenId),
    dependencies: uniqueBy([...required.dependencies, ...selectedDependencies], dependencyKey)
      .sort((left, right) => dependencyKey(left).localeCompare(dependencyKey(right))),
  }
}

function contextNodeIds(requiredNodeIds: ReadonlySet<string>, content: ContextPacketContent): Set<string> {
  const result = new Set(requiredNodeIds)
  for (const item of [...content.sourceFiles, ...content.symbols, ...content.tests, ...content.dependencies]) {
    if (item.nodeId) result.add(item.nodeId)
  }
  for (const impact of [
    ...content.blastRadius.directConsumers,
    ...content.blastRadius.transitiveConsumers,
    ...content.blastRadius.affectedTests,
    ...content.blastRadius.dependentEpics,
  ]) result.add(impact.nodeId)
  return result
}

function createMeasuredPacket(
  content: ContextPacketContent,
  nodeIds: ReadonlySet<string>,
  budget: number,
  candidateEstimate: number,
  enforceBudget = true,
): ContextPacket {
  const sourceFingerprint = createHash("sha256").update(JSON.stringify(content)).digest("hex")
  let estimated = estimateContextTokens(content)
  let packet: ContextPacket | undefined
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const overBudget = enforceBudget && estimated > budget
    const reductionPercentage = candidateEstimate === 0
      ? 0
      : Math.max(0, Math.round((1 - estimated / candidateEstimate) * 10_000) / 100)
    packet = contextPacketSchema.parse({
      ...content,
      sourceFingerprint,
      relevantNodeIds: [...nodeIds].sort(),
      tokenUsage: { budget, estimated, candidateEstimate, reductionPercentage, overBudget },
      diagnostics: overBudget ? [{
        code: "CONTEXT_BUDGET_EXCEEDED",
        message: "Required implementation context exceeds the requested token budget.",
      }] : [],
    })
    const measured = estimateContextTokens(renderContextPacket(packet))
    if (measured === estimated) return packet
    estimated = measured
  }
  return packet!
}

function latestApprovedDesign(designs: TechnicalDesign[], epicId: string): TechnicalDesign | undefined {
  const latest = designs.filter((design) => design.targetId === epicId)
    .sort((left, right) => right.revision - left.revision)[0]
  return latest && (latest.status === "approved" || latest.status === "scaffolded") ? latest : undefined
}

async function compileBlastRadius(
  queries: WorkspaceGraphQueries,
  epicId: string,
  designId: string,
  designFileIds: string[],
  designSymbolIds: string[],
  requiredTests: ContextTest[],
  available: { sourceAnalysis: boolean, dependentEpics: boolean, dependentDesigns: boolean },
): Promise<ContextPacket["blastRadius"]> {
  const seedIds = new Set([...designFileIds, ...designSymbolIds])
  const [importConsumers, referenceConsumers, testedNodes, dependentEpics, dependentDesigns] = await Promise.all([
    available.sourceAnalysis ? searchImpacts(queries, designFileIds, ["IMPORTS"], "imports", 2) : [],
    available.sourceAnalysis ? searchImpacts(queries, [...designFileIds, ...designSymbolIds], ["REFERENCES"], "references", 2) : [],
    available.sourceAnalysis ? searchImpacts(queries, designSymbolIds, ["TESTS"], "tests", 1) : [],
    available.dependentEpics ? searchImpacts(queries, [epicId], ["DEPENDS_ON"], "depends-on", 2) : [],
    available.dependentDesigns
      ? searchNeighborNodes(queries, [designId, ...designFileIds, ...designSymbolIds], ["DEPENDS_ON"], 1)
      : [],
  ])
  const consumers = uniqueImpacts([...importConsumers, ...referenceConsumers])
    .filter((impact) => !seedIds.has(impact.nodeId) && (impact.kind === "file" || impact.kind === "symbol"))
  const direct = consumers.filter((impact) => impact.depth === 1)
  const transitive = consumers.filter((impact) => impact.depth > 1)
  const affectedTests = uniqueImpacts([
    ...testedNodes.filter((impact) => impact.kind === "test"),
    ...requiredTests.map((test): ContextImpact => ({
      nodeId: test.nodeId,
      kind: "test",
      path: test.path,
      name: test.name,
      depth: 1,
      reason: "tests",
    })),
  ])
  const epicImpacts = dependentEpics.filter((impact) => impact.kind === "epic" && impact.nodeId !== epicId)
  const designTargets = await Promise.all(dependentDesigns.flatMap(async (design): Promise<ContextImpact[]> => {
    if (design.kind !== "TechnicalDesign" || typeof design.props.targetId !== "string" || design.props.targetId === epicId) return []
    const epic = await queries.getNode(design.props.targetId)
    return epic?.kind === "Epic" ? [{
      nodeId: epic.id,
      kind: "epic",
      name: typeof epic.props.title === "string" ? epic.props.title : epic.id,
      depth: design.depth,
      reason: "depends-on",
    }] : []
  }))
  const epics = uniqueImpacts([...epicImpacts, ...designTargets.flat()])
  const totals = {
    directConsumers: direct.length,
    transitiveConsumers: transitive.length,
    affectedTests: affectedTests.length,
    dependentEpics: epics.length,
  }
  return {
    directConsumers: direct.slice(0, MAX_IMPACTS_PER_SECTION),
    transitiveConsumers: transitive.slice(0, MAX_IMPACTS_PER_SECTION),
    affectedTests: affectedTests.slice(0, MAX_IMPACTS_PER_SECTION),
    dependentEpics: epics.slice(0, MAX_IMPACTS_PER_SECTION),
    totals,
    truncated: Object.values(totals).some((count) => count > MAX_IMPACTS_PER_SECTION),
  }
}

async function searchImpacts(
  queries: WorkspaceGraphQueries,
  seedIds: string[],
  edgeKinds: WorkspaceGraphEdgeKind[],
  reason: ContextImpact["reason"],
  depth: number,
): Promise<ContextImpact[]> {
  const nodes = await searchNeighborNodes(queries, seedIds, edgeKinds, depth)
  return nodes.flatMap((node) => {
    const impact = impactFromNode(node, reason)
    return impact ? [impact] : []
  })
}

async function searchNeighborNodes(
  queries: WorkspaceGraphQueries,
  seedIds: string[],
  edgeKinds: WorkspaceGraphEdgeKind[],
  depth: number,
): Promise<GraphNeighborRecord[]> {
  const groups = await Promise.all([...new Set(seedIds)].map((nodeId) => queries.searchNeighbors({
    nodeId,
    direction: "incoming",
    edgeKinds,
    depth,
  })))
  return groups.flat()
}

function impactFromNode(node: GraphNeighborRecord, reason: ContextImpact["reason"]): ContextImpact | null {
  if (node.kind === "File") {
    if (parseFileKind(node.props.fileKind) === "test") return null
    return { nodeId: node.id, kind: "file", path: String(node.props.path), depth: node.depth, reason }
  }
  if (node.kind === "CodeSymbol") {
    return {
      nodeId: node.id,
      kind: "symbol",
      ...(typeof node.props.path === "string" ? { path: node.props.path } : {}),
      name: String(node.props.name),
      depth: node.depth,
      reason,
    }
  }
  if (node.kind === "Test") {
    return { nodeId: node.id, kind: "test", path: String(node.props.path), name: String(node.props.name), depth: node.depth, reason }
  }
  if (node.kind === "Epic") {
    return { nodeId: node.id, kind: "epic", name: String(node.props.title), depth: node.depth, reason }
  }
  return null
}

function uniqueImpacts(impacts: ContextImpact[]): ContextImpact[] {
  const byNode = new Map<string, ContextImpact>()
  for (const impact of impacts) {
    const key = impact.kind + ":" + impact.nodeId
    const current = byNode.get(key)
    if (!current || impact.depth < current.depth || (impact.depth === current.depth && impact.reason < current.reason)) {
      byNode.set(key, impact)
    }
  }
  return [...byNode.values()].sort((left, right) =>
    left.depth - right.depth
    || (left.path ?? left.name ?? left.nodeId).localeCompare(right.path ?? right.name ?? right.nodeId)
    || left.nodeId.localeCompare(right.nodeId),
  )
}

interface DependencyContext {
  dependencies: ContextDependency[]
  files: Array<{
    nodeId: string
    path: string
    kind: string
    relevance: "dependency"
    score: number
  }>
  symbols: Array<{
    nodeId: string
    path: string
    symbol: TechnicalDesign["modules"][number]["files"][number]["exports"][number]
    score: number
  }>
  nodeIds: Set<string>
}

function collectDependencyContext(
  design: TechnicalDesign,
  designs: TechnicalDesign[],
  planning: z.infer<typeof planningStateSchema>,
  implementationStates: ReadonlyMap<string, string>,
): DependencyContext {
  const context: DependencyContext = { dependencies: [], files: [], symbols: [], nodeIds: new Set() }
  const epics = new Map((planning.epics ?? []).map((epic) => [epic.id, epic]))
  for (const relationship of planning.relationships) {
    if (relationship.type !== "DEPENDS_ON" || relationship.sourceId !== design.targetId) continue
    const epic = epics.get(relationship.targetId)
    if (!epic) continue
    context.dependencies.push({
      nodeId: epic.id,
      kind: "epic",
      label: epic.title,
      status: implementationStates.get(epic.id) ?? "planned",
      required: true,
    })
    context.nodeIds.add(epic.id)
    const predecessorDesign = latestApprovedDesign(designs, epic.id)
    if (predecessorDesign) addDesignInterfaces(context, predecessorDesign)
  }
  for (const dependency of design.dependencies) {
    const target = designs.find((candidate) => candidate.id === dependency.targetDesignId)
    const resolution = design.resolution?.find((item) =>
      technicalDependencyKey(item.dependency) === technicalDependencyKey(dependency),
    )
    if (!target) {
      context.dependencies.push({
        kind: dependency.kind,
        label: dependency.kind === "symbol" ? dependency.symbolName : dependency.kind === "file" ? dependency.filePath : dependency.targetDesignId,
        ...(dependency.kind === "technical-design" ? {} : { path: dependency.filePath }),
        status: resolution?.status ?? "blocked",
        reason: resolution?.reason ?? "Target Technical Design does not exist.",
        required: true,
      })
      continue
    }
    if (dependency.kind === "technical-design") {
      context.dependencies.push({
        nodeId: target.id,
        kind: "technical-design",
        label: target.id,
        status: resolution?.status,
        ...(resolution?.reason ? { reason: resolution.reason } : {}),
        required: true,
      })
      addDesignInterfaces(context, target)
      continue
    }
    const module = target.modules.find((candidate) =>
      candidate.files.some((file) => file.path === dependency.filePath),
    )
    const file = module?.files.find((candidate) => candidate.path === dependency.filePath)
    const fileId = createFileGraphId(target.profile.rootPath, dependency.filePath)
    const nodeId = dependency.kind === "symbol"
      ? createSymbolGraphId(target.profile.rootPath, dependency.filePath, dependency.symbolName)
      : fileId
    context.dependencies.push({
      nodeId,
      kind: dependency.kind,
      label: dependency.kind === "symbol" ? dependency.symbolName : dependency.filePath,
      path: dependency.filePath,
      status: resolution?.status,
      ...(resolution?.reason ? { reason: resolution.reason } : {}),
      required: true,
    })
    context.nodeIds.add(target.id)
    context.nodeIds.add(nodeId)
    if (module) context.nodeIds.add(createModuleGraphId(target.profile.rootPath, module.path))
    if (!file) continue
    context.nodeIds.add(fileId)
    context.files.push({ nodeId: fileId, path: file.path, kind: file.kind, relevance: "dependency", score: 100 })
    const symbols = dependency.kind === "symbol"
      ? file.exports.filter((symbol) => symbol.name === dependency.symbolName)
      : file.exports
    for (const symbol of symbols) {
      const symbolId = createSymbolGraphId(target.profile.rootPath, file.path, symbol.name)
      context.nodeIds.add(symbolId)
      context.symbols.push({ nodeId: symbolId, path: file.path, symbol, score: 95 })
    }
  }
  return context
}

function addDesignInterfaces(context: DependencyContext, design: TechnicalDesign): void {
  context.nodeIds.add(design.id)
  for (const module of design.modules) {
    const interfaceFiles = module.files.filter((file) => file.exports.length > 0)
    if (interfaceFiles.length === 0) continue
    context.nodeIds.add(createModuleGraphId(design.profile.rootPath, module.path))
    for (const file of interfaceFiles) {
      const fileId = createFileGraphId(design.profile.rootPath, file.path)
      context.nodeIds.add(fileId)
      context.files.push({ nodeId: fileId, path: file.path, kind: file.kind, relevance: "dependency", score: 100 })
      for (const symbol of file.exports) {
        const symbolId = createSymbolGraphId(design.profile.rootPath, file.path, symbol.name)
        context.nodeIds.add(symbolId)
        context.symbols.push({ nodeId: symbolId, path: file.path, symbol, score: 95 })
      }
    }
  }
}

function technicalDependencyKey(dependency: TechnicalDesign["dependencies"][number]): string {
  return dependency.kind === "technical-design"
    ? dependency.kind + ":" + dependency.targetDesignId
    : dependency.kind + ":" + dependency.targetDesignId + ":" + dependency.filePath
      + (dependency.kind === "symbol" ? ":" + dependency.symbolName : "")
}

function sourceFile(
  node: GraphNodeRecord | null,
  nodeId: string,
  fallbackPath: string,
  fallbackKind: string,
  relevance: ContextSourceFile["relevance"],
  score: number,
): ContextSourceFile {
  return {
    nodeId,
    path: node ? String(node.props.path) : fallbackPath,
    fileKind: parseFileKind(node?.props.fileKind ?? fallbackKind),
    relevance,
    score,
  }
}

function contextSymbol(
  node: GraphNodeRecord | null,
  nodeId: string,
  path: string,
  fallback: TechnicalDesign["modules"][number]["files"][number]["exports"][number],
  score: number,
): ContextSymbol {
  return node ? graphSymbol(node, score) : {
    nodeId,
    path,
    name: fallback.name,
    symbolKind: fallback.kind,
    ...(fallback.signature ? { signature: fallback.signature } : {}),
    purpose: fallback.purpose,
    score,
  }
}

function graphSymbol(node: GraphNodeRecord, score: number): ContextSymbol {
  return {
    nodeId: node.id,
    ...(node.props.path ? { path: String(node.props.path) } : {}),
    name: String(node.props.name),
    symbolKind: String(node.props.symbolKind),
    ...(node.props.signature ? { signature: String(node.props.signature) } : {}),
    ...(node.props.purpose ? { purpose: String(node.props.purpose) } : {}),
    score,
  }
}

function graphTest(node: GraphNodeRecord, score: number): ContextTest {
  return {
    nodeId: node.id,
    path: String(node.props.path),
    name: String(node.props.name),
    framework: String(node.props.framework),
    score,
  }
}

function parseFileKind(value: unknown): ContextSourceFile["fileKind"] {
  return value === "test" || value === "configuration" || value === "asset" ? value : "source"
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [key(item), item])).values()]
}

function comparePathThenId<T extends { nodeId: string }>(left: T, right: T): number {
  const leftPath = "path" in left && typeof left.path === "string" ? left.path : ""
  const rightPath = "path" in right && typeof right.path === "string" ? right.path : ""
  return leftPath.localeCompare(rightPath) || left.nodeId.localeCompare(right.nodeId)
}

function dependencyKey(dependency: ContextDependency): string {
  return dependency.nodeId ?? [dependency.kind, dependency.path, dependency.label].join(":")
}
