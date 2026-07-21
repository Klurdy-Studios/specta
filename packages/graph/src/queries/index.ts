import type { Store } from "@nicia-ai/typegraph"
import { epicSchema, roadmapSchema } from "@specta/core"
import { z } from "zod"
import { workspaceGraph, workspaceGraphEdgeKinds, workspaceGraphNodeKinds } from "../ontology.ts"
import type {
  EligibleEpic,
  GraphEdgeRecord,
  GraphNeighborQuery,
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
    async nextEligibleEpic(): Promise<EligibleEpic | null> {
      const roadmapNode = (await listNodes("Roadmap"))[0]
      if (!roadmapNode) return null
      const roadmap = roadmapSchema.omit({ id: true }).safeParse(roadmapNode.props)
      if (!roadmap.success) return null
      const epics = (await listNodes("Epic")).flatMap((node) => {
        const parsed = epicSchema.omit({ id: true, stories: true }).safeParse(node.props)
        return parsed.success ? [{ id: node.id, ...parsed.data }] : []
      })
      const designs = (await listNodes("TechnicalDesign")).flatMap((node) => {
        const parsed = technicalDesignStateSchema.safeParse(node.props)
        return parsed.success ? [{ id: node.id, ...parsed.data }] : []
      })
      const states = await listNodes("EpicImplementationState")
      const statusByEpic = new Map(states.map((state) => [String(state.props.epicId), String(state.props.status)]))
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
      const ordered = epics.map((epic, index) => ({ epic, index }))
        .sort((left, right) =>
          (milestoneOrder.get(left.epic.roadmapMilestone) ?? Number.MAX_SAFE_INTEGER)
          - (milestoneOrder.get(right.epic.roadmapMilestone) ?? Number.MAX_SAFE_INTEGER)
          || left.index - right.index,
        )
      for (const item of ordered) {
        const status = statusByEpic.get(item.epic.id) ?? "planned"
        if (["complete", "in-progress", "blocked"].includes(status)) continue
        if ((prerequisites.get(item.epic.id) ?? []).some((id) => statusByEpic.get(id) !== "complete")) continue
        const design = latestApprovedDesign(designs, item.epic.id)
        if (!design) continue
        return {
          epicId: item.epic.id,
          title: item.epic.title,
          designId: design.id,
          roadmapIndex: milestoneOrder.get(item.epic.roadmapMilestone) ?? Number.MAX_SAFE_INTEGER,
        }
      }
      return null
    },
  }
}

function latestApprovedDesign(
  designs: Array<z.infer<typeof technicalDesignStateSchema> & { id: string }>,
  epicId: string,
) {
  const latest = designs.filter((design) => design.targetId === epicId)
    .sort((left, right) => right.revision - left.revision)[0]
  return latest && ["approved", "scaffolded"].includes(latest.status) ? latest : undefined
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
