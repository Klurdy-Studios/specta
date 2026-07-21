import {
  acceptanceCriterionSchema,
  architectureSchema,
  constitutionSchema,
  epicSchema,
  projectProfileSchema,
  roadmapSchema,
  scaffoldPlanSchema,
  storySchema,
  taskSchema,
  technicalDesignSchema,
  visionSchema,
  type PlanningState,
  type ProjectProfile,
  type ScaffoldPlan,
  type TechnicalDesign,
  type Workspace,
} from "@specta/core"
import type { AnalysisGraphSnapshot, AnalysisGraphNode } from "../analysis/snapshot.ts"
import { createFileGraphId, createModuleGraphId, createStableGraphId, createSymbolGraphId } from "../analysis/identifiers.ts"
import type {
  GraphEdgeUpsert,
  GraphNodeUpsert,
  GraphProjection,
  WorkspaceGraphEdgeKind,
  WorkspaceGraphNodeKind,
} from "../repository/contracts.ts"
import { createGraphEdge } from "./apply-projection.ts"

/** Converts canonical planning state into its owned graph projection. */
export function planningStateProjection(state: PlanningState): GraphProjection {
  const nodes: GraphNodeUpsert[] = []
  if (state.vision) nodes.push({ id: state.vision.id, kind: "Vision", props: visionSchema.omit({ id: true }).parse(omitId(state.vision)) })
  if (state.constitution) nodes.push({ id: state.constitution.id, kind: "Constitution", props: constitutionSchema.omit({ id: true }).parse(omitId(state.constitution)) })
  if (state.architecture) nodes.push({ id: state.architecture.id, kind: "Architecture", props: architectureSchema.omit({ id: true }).parse(omitId(state.architecture)) })
  if (state.roadmap) nodes.push({ id: state.roadmap.id, kind: "Roadmap", props: roadmapSchema.omit({ id: true }).parse(omitId(state.roadmap)) })
  for (const epic of state.epics ?? []) {
    const { id: _epicId, stories, ...epicProps } = epic
    nodes.push({ id: epic.id, kind: "Epic", props: epicSchema.omit({ id: true, stories: true }).parse(epicProps) })
    for (const story of stories) {
      const { id: _storyId, acceptanceCriteria, tasks, ...storyProps } = story
      nodes.push({ id: story.id, kind: "Story", props: storySchema.omit({ id: true, acceptanceCriteria: true, tasks: true }).parse(storyProps) })
      for (const criterion of acceptanceCriteria) {
        nodes.push({ id: criterion.id, kind: "AcceptanceCriterion", props: acceptanceCriterionSchema.omit({ id: true }).parse(omitId(criterion)) })
      }
      for (const task of tasks) nodes.push({ id: task.id, kind: "Task", props: taskSchema.omit({ id: true }).parse(omitId(task)) })
    }
  }
  const kindById = new Map(nodes.map((node) => [node.id, node.kind]))
  const edges = state.relationships.flatMap((relationship): GraphEdgeUpsert[] => {
    const sourceKind = kindById.get(relationship.sourceId)
    const targetKind = kindById.get(relationship.targetId)
    if (!sourceKind || !targetKind) return []
    return [edge(relationship.type, relationship.sourceId, relationship.targetId, sourceKind, targetKind)]
  })
  return { key: "planning", nodes, edges, documents: [{ key: "planning-state", value: state }] }
}

/** Converts all Technical Design revisions into one incrementally diffed projection. */
export function technicalDesignsProjection(designs: TechnicalDesign[]): GraphProjection {
  const validated = designs.map((design) => technicalDesignSchema.parse(design))
  const nodes: GraphNodeUpsert[] = []
  const edges: GraphEdgeUpsert[] = []
  const designById = new Map(validated.map((design) => [design.id, design]))
  for (const design of validated) {
    nodes.push({
      id: design.id,
      kind: "TechnicalDesign",
      props: {
        targetId: design.targetId,
        target: design.target,
        profile: design.profile,
        status: design.status,
        revision: design.revision,
        summary: design.summary,
        impactRequests: design.impactRequests,
        ...(design.feedback ? { feedback: design.feedback } : {}),
        ...(design.scaffoldedPaths ? { scaffoldedPaths: design.scaffoldedPaths } : {}),
      },
    })
    edges.push(edge("IMPLEMENTS", design.id, design.targetId, "TechnicalDesign", "Epic"))
    const root = design.profile.rootPath
    for (const module of design.modules) {
      const moduleId = createModuleGraphId(root, module.path)
      nodes.push({ id: moduleId, kind: "Module", props: { name: module.name, path: module.path, purpose: module.purpose } })
      edges.push(edge("CONTAINS", design.id, moduleId, "TechnicalDesign", "Module"))
      for (const file of module.files) {
        const fileId = createFileGraphId(root, file.path)
        nodes.push({
          id: fileId,
          kind: "File",
          props: { path: file.path, fileKind: file.kind, ...(design.profile.projectId ? { projectId: design.profile.projectId } : {}) },
        })
        edges.push(edge("CONTAINS", moduleId, fileId, "Module", "File"))
        for (const symbol of file.exports) {
          const symbolId = createSymbolGraphId(root, file.path, symbol.name)
          nodes.push({
            id: symbolId,
            kind: "CodeSymbol",
            props: {
              name: symbol.name,
              symbolKind: symbol.kind,
              path: file.path,
              purpose: symbol.purpose,
              ...(symbol.signature ? { signature: symbol.signature } : {}),
            },
          })
          edges.push(edge("CONTAINS", fileId, symbolId, "File", "CodeSymbol"))
          edges.push(edge("EXPORTS", fileId, symbolId, "File", "CodeSymbol"))
        }
      }
    }
    for (const dependency of design.dependencies) {
      const targetDesign = designById.get(dependency.targetDesignId)
      if (!targetDesign) {
        throw new Error("Technical Design dependency target is missing: " + dependency.targetDesignId + ".")
      }
      let targetId: string = dependency.targetDesignId
      let targetKind: WorkspaceGraphNodeKind = "TechnicalDesign"
      if (dependency.kind === "file") {
        if (!targetDesign.modules.some((module) => module.files.some((file) => file.path === dependency.filePath))) {
          throw new Error("Technical Design dependency file is missing: " + dependency.filePath + ".")
        }
        targetId = createFileGraphId(targetDesign.profile.rootPath, dependency.filePath)
        targetKind = "File"
      } else if (dependency.kind === "symbol") {
        if (!targetDesign.modules.some((module) => module.files.some((file) =>
          file.path === dependency.filePath && file.exports.some((symbol) => symbol.name === dependency.symbolName),
        ))) {
          throw new Error("Technical Design dependency symbol is missing: " + dependency.symbolName + ".")
        }
        targetId = createSymbolGraphId(targetDesign.profile.rootPath, dependency.filePath, dependency.symbolName)
        targetKind = "CodeSymbol"
      }
      edges.push(edge("DEPENDS_ON", design.id, targetId, "TechnicalDesign", targetKind))
    }
  }
  return {
    key: "technical-designs",
    priority: 50,
    nodes: keepLastById(nodes),
    edges: keepLastById(edges),
    documents: [{ key: "technical-designs", value: validated }],
  }
}

export function projectProfilesProjection(profiles: ProjectProfile[]): GraphProjection {
  const validated = profiles.map((profile) => projectProfileSchema.parse(profile))
  return {
    key: "project-profiles",
    nodes: validated.map((profile) => ({ id: projectProfileNodeId(profile), kind: "ProjectProfile", props: profile })),
    edges: [],
    documents: [{ key: "project-profiles", value: validated }],
  }
}

export function scaffoldRunsProjection(runs: ScaffoldPlan[]): GraphProjection {
  const validated = runs.map((run) => scaffoldPlanSchema.parse(run))
  return {
    key: "scaffold-runs",
    nodes: validated.map((run) => ({ id: run.id, kind: "ScaffoldRun", props: scaffoldPlanSchema.omit({ id: true }).parse(omitId(run)) })),
    edges: validated.map((run) => edge("IMPLEMENTS", run.id, run.designId, "ScaffoldRun", "TechnicalDesign")),
    documents: [{ key: "scaffold-runs", value: validated }],
  }
}

/** Converts parser output into the unified graph while retaining exact evidence as a document. */
export function analysisProjection(snapshot: AnalysisGraphSnapshot): GraphProjection {
  const kindById = new Map(snapshot.nodes.map((node) => [node.id, analysisNodeKind(node)]))
  return {
    key: "analysis",
    priority: 100,
    nodes: snapshot.nodes.map((node) => analysisNode(node)),
    edges: snapshot.relationships.map((relationship) => edge(
      relationship.type,
      relationship.sourceId,
      relationship.targetId,
      kindById.get(relationship.sourceId),
      kindById.get(relationship.targetId),
    )),
    documents: [{ key: "analysis", value: snapshot }],
  }
}

function analysisNode(node: AnalysisGraphNode): GraphNodeUpsert {
  const { id, type: _type, ...props } = node
  return { id, kind: analysisNodeKind(node), props }
}

function analysisNodeKind(node: AnalysisGraphNode): WorkspaceGraphNodeKind {
  const kinds = {
    SPECIFICATION_DOCUMENT: "SpecificationDocument",
    SPECIFICATION_ENTITY: "SpecificationEntity",
    FILE: "File",
    CODE_SYMBOL: "CodeSymbol",
    TEST: "Test",
    EXTERNAL_DEPENDENCY: "ExternalDependency",
  } as const
  return kinds[node.type]
}

function edge(
  kind: WorkspaceGraphEdgeKind,
  sourceId: string,
  targetId: string,
  sourceKind?: WorkspaceGraphNodeKind,
  targetKind?: WorkspaceGraphNodeKind,
): GraphEdgeUpsert {
  return createGraphEdge({
    kind,
    sourceId,
    targetId,
    ...(sourceKind ? { sourceKind } : {}),
    ...(targetKind ? { targetKind } : {}),
  })
}

function projectProfileNodeId(profile: ProjectProfile): string {
  return profile.projectId ?? createStableGraphId("profile", profile.rootPath, profile.name)
}

function omitId<T extends { id: unknown }>(value: T): Omit<T, "id"> {
  const { id: _id, ...rest } = value
  return rest
}

function keepLastById<T extends { id: string }>(items: T[]): T[] {
  const byId = new Map<string, T>()
  for (const item of items) byId.set(item.id, item)
  return [...byId.values()]
}
