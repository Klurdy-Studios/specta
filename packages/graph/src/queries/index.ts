import type { Store } from "@nicia-ai/typegraph"
import { epicSchema, roadmapSchema } from "@specta/core"
import { z } from "zod"
import { workspaceGraph, workspaceGraphEdgeKinds, workspaceGraphNodeKinds } from "../ontology.ts"
import type {
  EligibleEpic,
  GraphEdgeRecord,
  GraphNeighborQuery,
  GraphNeighborRecord,
  GraphNodeRecord,
  GraphSubgraph,
  WorkspaceGraphEdgeKind,
  WorkspaceGraphNodeKind,
  WorkspaceGraphQueries,
} from "../repository/contracts.ts"

type GraphStore = Store<typeof workspaceGraph>

const technicalDesignStateSchema = z.object({
  targetId: z.string(),
  status: z.enum(["draft", "approved", "superseded", "scaffolded"]),
  revision: z.number().int().positive(),
})
const epicNodeStateSchema = epicSchema.omit({ id: true, stories: true }).extend({
  planningOrder: z.number().int().nonnegative().optional(),
})

/** Builds bounded, domain-aware queries over the unified Workspace Graph. */
export function createWorkspaceGraphQueries(
  store: GraphStore,
  resolveNodeKind?: (id: string) => Promise<WorkspaceGraphNodeKind | undefined>,
): WorkspaceGraphQueries {
  const getNode = async (id: string): Promise<GraphNodeRecord | null> => {
    const resolvedKind = await resolveNodeKind?.(id)
    if (resolvedKind) {
      const value = await store.getNodeCollectionOrThrow(resolvedKind).getById(id)
      if (value) return nodeRecord(value, resolvedKind)
    }
    for (const kind of workspaceGraphNodeKinds) {
      if (kind === resolvedKind) continue
      const value = await store.getNodeCollectionOrThrow(kind).getById(id)
      if (value) return nodeRecord(value, kind)
    }
    return null
  }
  const listNodes = async (kind: WorkspaceGraphNodeKind): Promise<GraphNodeRecord[]> =>
    (await store.getNodeCollectionOrThrow(kind).find())
      .map((value) => nodeRecord(value, kind)).sort((a, b) => a.id.localeCompare(b.id))

  const searchNeighbors = async (request: GraphNeighborQuery): Promise<GraphNeighborRecord[]> => {
    const depth = Math.max(0, Math.min(request.depth ?? 1, 10))
    if (depth === 0) return []
    const discovered = await store.algorithms.neighbors(request.nodeId, {
      edges: request.edgeKinds ?? workspaceGraphEdgeKinds,
      depth,
      direction: request.direction === "incoming" ? "in" : request.direction === "both" ? "both" : "out",
    })
    const records = await Promise.all(discovered.map(async (item): Promise<GraphNeighborRecord | null> => {
      if (!workspaceGraphNodeKinds.includes(item.kind as WorkspaceGraphNodeKind)) return null
      const kind = item.kind as WorkspaceGraphNodeKind
      const value = await store.getNodeCollectionOrThrow(kind).getById(item.id)
      return value ? { ...nodeRecord(value, kind), depth: item.depth } : null
    }))
    return records.filter((node): node is GraphNeighborRecord => node !== null)
      .sort((left, right) => left.depth - right.depth || left.id.localeCompare(right.id))
  }

  const neighbors = async (request: GraphNeighborQuery): Promise<GraphSubgraph> => {
    const depth = Math.max(0, Math.min(request.depth ?? 1, 10))
    const requestedKinds = request.edgeKinds ?? workspaceGraphEdgeKinds
    const visited = new Set([request.nodeId])
    let frontier = (await Promise.all([request.nodeId].map(getNode))).filter((node): node is GraphNodeRecord => node !== null)
    const includedEdges = new Map<string, GraphEdgeRecord>()
    for (let level = 0; level < depth; level += 1) {
      const nextIds = new Set<string>()
      const edgeBatches = await Promise.all(frontier.flatMap((node) => requestedKinds.flatMap(async (kind) => {
        const collection = store.getEdgeCollectionOrThrow(kind)
        const ref = { kind: node.kind, id: node.id }
        const outgoing = request.direction === "incoming" ? [] : await collection.find({ from: ref })
        const incoming = request.direction === "outgoing" ? [] : await collection.find({ to: ref })
        return [...outgoing, ...incoming].map((value) => edgeRecord(value, kind))
      })))
      for (const edge of edgeBatches.flat()) {
        includedEdges.set(edge.id, edge)
        const candidate = visited.has(edge.sourceId) ? edge.targetId : edge.sourceId
        if (!visited.has(candidate)) {
          visited.add(candidate)
          nextIds.add(candidate)
        }
      }
      frontier = (await Promise.all([...nextIds].map(getNode))).filter((node): node is GraphNodeRecord => node !== null)
      if (frontier.length === 0) break
    }
    const includedNodes = (await Promise.all([...visited].map(getNode))).filter((node): node is GraphNodeRecord => node !== null)
    return {
      nodes: includedNodes.sort((a, b) => a.id.localeCompare(b.id)),
      edges: [...includedEdges.values()].sort((a, b) => a.id.localeCompare(b.id)),
    }
  }

  return {
    getNode,
    listNodes,
    searchNeighbors,
    neighbors,
    dependencies: (nodeId, depth = 1) => neighbors({
      nodeId,
      depth,
      direction: "outgoing",
      edgeKinds: ["DEPENDS_ON", "IMPORTS"],
    }),
    dependents: (nodeId, depth = 1) => neighbors({
      nodeId,
      depth,
      direction: "incoming",
      edgeKinds: ["DEPENDS_ON", "IMPORTS"],
    }),
    async eligibleEpic(epicId): Promise<EligibleEpic | null> {
      return (await eligibleEpics(epicId))[0] ?? null
    },
    async nextEligibleEpic(): Promise<EligibleEpic | null> {
      return (await eligibleEpics())[0] ?? null
    },
  }

  async function eligibleEpics(requestedEpicId?: string): Promise<EligibleEpic[]> {
    const roadmapNode = (await listNodes("Roadmap"))[0]
    if (!roadmapNode) return []
    const roadmap = roadmapSchema.omit({ id: true }).safeParse(roadmapNode.props)
    if (!roadmap.success) return []
    const epics = (await listNodes("Epic")).flatMap((node) => {
      const parsed = epicNodeStateSchema.safeParse(node.props)
      return parsed.success ? [{ id: node.id, ...parsed.data }] : []
    })
    const designs = (await listNodes("TechnicalDesign")).flatMap((node) => {
      const parsed = technicalDesignStateSchema.safeParse(node.props)
      return parsed.success ? [{ id: node.id, ...parsed.data }] : []
    })
    const designById = new Map(designs.map((design) => [design.id, design]))
    const latestDesignByEpic = new Map<string, (typeof designs)[number]>()
    for (const design of [...designs].sort((left, right) => right.revision - left.revision)) {
      if (!latestDesignByEpic.has(design.targetId)) latestDesignByEpic.set(design.targetId, design)
    }
    const states = await listNodes("EpicImplementationState")
    const statusByEpic = new Map(states.map((state) => [String(state.props.epicId), String(state.props.status)]))
    const stateByEpic = new Map(states.map((state) => [String(state.props.epicId), state.props]))
    const runsById = new Map((await listNodes("WorkflowRun")).map((run) => [run.id, run.props]))
    const epicIds = new Set(epics.map((epic) => epic.id))
    const prerequisites = new Map<string, string[]>()
    for (const value of await store.getEdgeCollectionOrThrow("DEPENDS_ON").find()) {
      const relationship = edgeRecord(value, "DEPENDS_ON")
      if (epicIds.has(relationship.sourceId) && epicIds.has(relationship.targetId)) {
        const current = prerequisites.get(relationship.sourceId) ?? []
        current.push(relationship.targetId)
        prerequisites.set(relationship.sourceId, current)
      }
    }
    const milestoneOrder = new Map(roadmap.data.milestones.map((milestone, index) => [milestone.title, index]))
    const ordered = epics.map((epic) => ({ epic }))
      .sort((left, right) =>
        (milestoneOrder.get(left.epic.roadmapMilestone) ?? Number.MAX_SAFE_INTEGER)
        - (milestoneOrder.get(right.epic.roadmapMilestone) ?? Number.MAX_SAFE_INTEGER)
        || (left.epic.planningOrder ?? Number.MAX_SAFE_INTEGER)
        - (right.epic.planningOrder ?? Number.MAX_SAFE_INTEGER)
        || left.epic.id.localeCompare(right.epic.id),
      )
    const activeStatuses = new Set(["ready", "in-progress", "validation-failed", "blocked"])
    const active = ordered.filter((item) => activeStatuses.has(statusByEpic.get(item.epic.id) ?? "planned"))
    const candidates = active.length > 0
      ? (requestedEpicId && active[0]!.epic.id !== requestedEpicId ? [] : active.slice(0, 1))
      : requestedEpicId ? ordered.filter((item) => item.epic.id === requestedEpicId) : ordered
    const eligible: EligibleEpic[] = []
    for (const item of candidates) {
      const status = statusByEpic.get(item.epic.id) ?? "planned"
      if (["complete", "blocked"].includes(status)) continue
      if ((prerequisites.get(item.epic.id) ?? []).some((id) => statusByEpic.get(id) !== "complete")) continue
      const activeRunId = String(stateByEpic.get(item.epic.id)?.activeRunId ?? "")
      const boundDesignId = String(runsById.get(activeRunId)?.technicalDesignId ?? "")
      const design = boundDesignId ? designById.get(boundDesignId) : latestDesignByEpic.get(item.epic.id)
      if (!design || design.targetId !== item.epic.id || (!boundDesignId && design.status !== "scaffolded")) continue
      eligible.push({
        epicId: item.epic.id,
        title: item.epic.title,
        designId: design.id,
        roadmapIndex: milestoneOrder.get(item.epic.roadmapMilestone) ?? Number.MAX_SAFE_INTEGER,
      })
    }
    return eligible
  }
}

function nodeRecord(value: Record<string, unknown>, kind: WorkspaceGraphNodeKind): GraphNodeRecord {
  const { id, meta: _meta, kind: _kind, ...props } = value
  return { id: String(id), kind, props }
}

function edgeRecord(value: Record<string, unknown>, kind: WorkspaceGraphEdgeKind): GraphEdgeRecord {
  const { id, meta: _meta, kind: _kind, fromId, toId, fromKind, toKind, ...props } = value
  return {
    id: String(id),
    kind,
    sourceId: String(fromId),
    targetId: String(toId),
    sourceKind: String(fromKind) as WorkspaceGraphNodeKind,
    targetKind: String(toKind) as WorkspaceGraphNodeKind,
    props,
  }
}
