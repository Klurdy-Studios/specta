import type { Workspace } from "@specta/core"
import type { workspaceGraph } from "../ontology.ts"

/** Canonical node kinds persisted in the Workspace Graph. */
export type WorkspaceGraphNodeKind = keyof typeof workspaceGraph.nodes

/** Canonical relationship kinds persisted in the Workspace Graph. */
export type WorkspaceGraphEdgeKind = keyof typeof workspaceGraph.edges

/** One deterministic node upsert produced by a domain projection. */
export interface GraphNodeUpsert {
  id: string
  kind: WorkspaceGraphNodeKind
  props: Record<string, unknown>
}

/** One deterministic relationship upsert produced by a domain projection. */
export interface GraphEdgeUpsert {
  id: string
  kind: WorkspaceGraphEdgeKind
  sourceId: string
  targetId: string
  sourceKind?: WorkspaceGraphNodeKind
  targetKind?: WorkspaceGraphNodeKind
  props?: Record<string, unknown>
}

/** Exact domain document stored transactionally beside its graph projection. */
export interface GraphDocumentUpsert {
  key: string
  value: unknown
}

/** Complete owned projection used to calculate incremental database writes. */
export interface GraphProjection {
  key: string
  /** Merge precedence when multiple projections contribute properties to one entity. */
  priority?: number
  nodes: GraphNodeUpsert[]
  edges: GraphEdgeUpsert[]
  documents?: GraphDocumentUpsert[]
}

/** Write counts returned after applying a graph projection. */
export interface GraphUpdateSummary {
  createdNodes: number
  updatedNodes: number
  deletedNodes: number
  createdEdges: number
  updatedEdges: number
  deletedEdges: number
  unchanged: number
}

/** Materialized graph node returned by query APIs. */
export type GraphNodeRecord = GraphNodeUpsert
/** Materialized graph relationship returned by query APIs. */
export type GraphEdgeRecord = GraphEdgeUpsert

/** Deterministically ordered nodes and relationships from a bounded traversal. */
export interface GraphSubgraph {
  nodes: GraphNodeRecord[]
  edges: GraphEdgeRecord[]
}

/** Parameters for a bounded neighborhood traversal. */
export interface GraphNeighborQuery {
  nodeId: string
  direction?: "incoming" | "outgoing" | "both"
  edgeKinds?: WorkspaceGraphEdgeKind[]
  depth?: number
}

/** One node discovered by TypeGraph's set-based neighborhood search. */
export interface GraphNeighborRecord extends GraphNodeRecord {
  depth: number
}

/** Next implementation candidate selected from planning, design, and workflow state. */
export interface EligibleEpic {
  epicId: string
  title: string
  designId: string
  roadmapIndex: number
}

/** Read-only graph operations available within a Workspace graph session. */
export interface WorkspaceGraphQueries {
  getNode(id: string): Promise<GraphNodeRecord | null>
  listNodes(kind: WorkspaceGraphNodeKind): Promise<GraphNodeRecord[]>
  neighbors(request: GraphNeighborQuery): Promise<GraphSubgraph>
  /** Uses TypeGraph's native breadth-first algorithm and returns discovered nodes with minimum depth. */
  searchNeighbors(request: GraphNeighborQuery): Promise<GraphNeighborRecord[]>
  dependencies(nodeId: string, depth?: number): Promise<GraphSubgraph>
  dependents(nodeId: string, depth?: number): Promise<GraphSubgraph>
  eligibleEpic(epicId: string): Promise<EligibleEpic | null>
  nextEligibleEpic(): Promise<EligibleEpic | null>
}

/** Incremental, transactional graph projection writer. */
export interface GraphProjectionWriter {
  apply(projection: GraphProjection): Promise<GraphUpdateSummary>
  /** Applies ordered projections in one database transaction. */
  applyMany(projections: GraphProjection[]): Promise<GraphUpdateSummary[]>
}

/** Projection and document operations scoped to one SQLite transaction. */
export interface WorkspaceGraphTransaction {
  projections: GraphProjectionWriter
  readDocument<T>(key: string): Promise<T | null>
}

/** One open Workspace Graph connection exposed only for a bounded operation. */
export interface WorkspaceGraphSession {
  queries: WorkspaceGraphQueries
  projections: GraphProjectionWriter
  readDocument<T>(key: string): Promise<T | null>
  transaction<T>(operation: (graph: WorkspaceGraphTransaction) => Promise<T>): Promise<T>
}

/** Connection-lifecycle boundary for one SQLite graph per Workspace. */
export interface WorkspaceGraphProvider {
  withGraph<T>(workspace: Workspace, operation: (graph: WorkspaceGraphSession) => Promise<T>): Promise<T>
}
