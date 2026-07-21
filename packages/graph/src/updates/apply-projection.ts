import { createHash } from "node:crypto"
import { sql } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import type { DynamicEdgeCollection, DynamicNodeCollection, TransactionContext } from "@nicia-ai/typegraph"
import { workspaceGraph, workspaceGraphEdgeKinds, workspaceGraphNodeKinds } from "../ontology.ts"
import type {
  GraphEdgeUpsert,
  GraphProjection,
  GraphUpdateSummary,
  WorkspaceGraphEdgeKind,
  WorkspaceGraphNodeKind,
} from "../repository/contracts.ts"

type GraphTransaction = TransactionContext<typeof workspaceGraph>
type EntityType = "node" | "edge" | "document"

interface OwnershipRow {
  projection_key: string
  entity_type: EntityType
  entity_id: string
  entity_kind: string | null
  priority: number
  fingerprint: string
  payload: string
}

interface DesiredOwnership {
  type: EntityType
  id: string
  kind?: string
  priority: number
  fingerprint: string
  payload: string
}

interface StoredNodePayload {
  kind: WorkspaceGraphNodeKind
  props: Record<string, unknown>
}

interface StoredEdgePayload {
  kind: WorkspaceGraphEdgeKind
  sourceId: string
  targetId: string
  sourceKind?: WorkspaceGraphNodeKind
  targetKind?: WorkspaceGraphNodeKind
  props: Record<string, unknown>
}

/** Applies one complete projection as an atomic, ownership-aware incremental diff. */
export async function applyGraphProjection(
  transaction: GraphTransaction,
  projection: GraphProjection,
): Promise<GraphUpdateSummary> {
  validateProjection(projection)
  const database = transaction.sql as BetterSQLite3Database
  const priority = projection.priority ?? 0
  const previous = await database.all<OwnershipRow>(sql`
    SELECT projection_key, entity_type, entity_id, entity_kind, priority, fingerprint, payload
    FROM specta_projection_ownership
    WHERE projection_key = ${projection.key}
  `)
  const previousByKey = new Map(previous.map((row) => [
    ownershipKey({ type: row.entity_type, id: row.entity_id }),
    row,
  ]))
  const desired = desiredOwnership(projection, priority)
  const desiredKeys = new Set(desired.map(ownershipKey))
  const stale = previous.filter((row) => !desiredKeys.has(ownershipKey({ type: row.entity_type, id: row.entity_id })))
  const changed = desired.filter((owner) => {
    const current = previousByKey.get(ownershipKey(owner))
    return !current
      || current.entity_kind !== (owner.kind ?? null)
      || current.priority !== owner.priority
      || current.fingerprint !== owner.fingerprint
      || current.payload !== owner.payload
  })
  const changedKeys = new Set(changed.map(ownershipKey))

  await deleteOwnership(database, projection.key, stale)
  await upsertOwnership(database, projection.key, changed)

  const summary: GraphUpdateSummary = {
    createdNodes: 0, updatedNodes: 0, deletedNodes: 0,
    createdEdges: 0, updatedEdges: 0, deletedEdges: 0, unchanged: 0,
  }
  summary.unchanged = desired.filter((owner) =>
    owner.type !== "document" && !changedKeys.has(ownershipKey(owner)),
  ).length
  const affectedNodes = affectedIds("node", changed, stale)
  const affectedEdges = affectedIds("edge", changed, stale)
  const affectedDocuments = affectedIds("document", changed, stale)
  const nodeOwners = await readOwnersForIds(database, "node", affectedNodes)
  const edgeOwners = await readOwnersForIds(database, "edge", affectedEdges)
  const documentOwners = await readOwnersForIds(database, "document", affectedDocuments)

  for (const id of affectedNodes) {
    const owners = nodeOwners.get(id) ?? []
    if (owners.length > 0) await materializeNode(transaction, id, owners, summary)
  }
  for (const id of affectedEdges) {
    await materializeEdge(transaction, id, edgeOwners.get(id) ?? [], summary)
  }
  for (const id of affectedNodes) {
    if ((nodeOwners.get(id) ?? []).length === 0) await deleteNode(transaction, id, summary)
  }
  for (const key of affectedDocuments) await materializeDocument(database, key, documentOwners.get(key) ?? [])
  return summary
}

async function deleteOwnership(
  database: BetterSQLite3Database,
  projectionKey: string,
  rows: OwnershipRow[],
): Promise<void> {
  for (let index = 0; index < rows.length; index += 100) {
    const chunk = rows.slice(index, index + 100)
    await database.run(sql`DELETE FROM specta_projection_ownership
      WHERE projection_key = ${projectionKey}
        AND (entity_type, entity_id) IN (${sql.join(
          chunk.map((row) => sql`(${row.entity_type}, ${row.entity_id})`),
          sql`, `,
        )})`)
  }
}

async function upsertOwnership(
  database: BetterSQLite3Database,
  projectionKey: string,
  owners: DesiredOwnership[],
): Promise<void> {
  for (let index = 0; index < owners.length; index += 100) {
    const chunk = owners.slice(index, index + 100)
    await database.run(sql`INSERT INTO specta_projection_ownership
      (projection_key, entity_type, entity_id, entity_kind, priority, fingerprint, payload)
      VALUES ${sql.join(chunk.map((owner) => sql`(
        ${projectionKey}, ${owner.type}, ${owner.id}, ${owner.kind ?? null},
        ${owner.priority}, ${owner.fingerprint}, ${owner.payload}
      )`), sql`, `)}
      ON CONFLICT(projection_key, entity_type, entity_id) DO UPDATE SET
        entity_kind = excluded.entity_kind,
        priority = excluded.priority,
        fingerprint = excluded.fingerprint,
        payload = excluded.payload`)
  }
}

function desiredOwnership(projection: GraphProjection, priority: number): DesiredOwnership[] {
  return [
    ...projection.nodes.map((node): DesiredOwnership => {
      const payload = stableStringify({ kind: node.kind, props: node.props })
      return { type: "node", id: node.id, kind: node.kind, priority, payload, fingerprint: hash(payload) }
    }),
    ...projection.edges.map((edge): DesiredOwnership => {
      const payload = stableStringify({
        kind: edge.kind,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        ...(edge.sourceKind ? { sourceKind: edge.sourceKind } : {}),
        ...(edge.targetKind ? { targetKind: edge.targetKind } : {}),
        props: edge.props ?? {},
      })
      return { type: "edge", id: edge.id, kind: edge.kind, priority, payload, fingerprint: hash(payload) }
    }),
    ...(projection.documents ?? []).map((document): DesiredOwnership => {
      const payload = stableStringify({ value: document.value })
      return { type: "document", id: document.key, priority, payload, fingerprint: hash(payload) }
    }),
  ]
}

async function materializeNode(
  transaction: GraphTransaction,
  id: string,
  owners: OwnershipRow[],
  summary: GraphUpdateSummary,
): Promise<void> {
  const payloads = owners.map((owner) => parseNodePayload(owner.payload))
  const kinds = new Set(payloads.map((payload) => payload.kind))
  if (kinds.size !== 1) throw new Error("Graph node owners disagree on kind for " + id + ".")
  const kind = payloads[0]!.kind
  const props = Object.assign({}, ...payloads.map((payload) => payload.props)) as Record<string, unknown>
  const collection = nodeCollection(transaction, kind)
  const current = await collection.getById(id)
  if (current && nodeFingerprint(current, kind) === hash(stableStringify({ kind, props }))) {
    summary.unchanged += 1
    return
  }
  const otherKind = current ? undefined : await findNodeKind(transaction, id)
  if (otherKind && otherKind !== kind) throw new Error("Graph node kind cannot change for " + id + ".")
  await collection.upsertByIdFromRecord(id, props)
  if (current) summary.updatedNodes += 1
  else summary.createdNodes += 1
}

async function materializeEdge(
  transaction: GraphTransaction,
  id: string,
  owners: OwnershipRow[],
  summary: GraphUpdateSummary,
): Promise<void> {
  if (owners.length === 0) {
    const kind = await findEdgeKind(transaction, id)
    if (kind) {
      await edgeCollection(transaction, kind).bulkDelete([id])
      summary.deletedEdges += 1
    }
    return
  }
  const payloads = owners.map((owner) => parseEdgePayload(owner.payload))
  const identity = payloads[0]!
  if (payloads.some((payload) =>
    payload.kind !== identity.kind
    || payload.sourceId !== identity.sourceId
    || payload.targetId !== identity.targetId
  )) throw new Error("Graph edge owners disagree on identity for " + id + ".")
  const props = Object.assign({}, ...payloads.map((payload) => payload.props)) as Record<string, unknown>
  const collection = edgeCollection(transaction, identity.kind)
  const current = await collection.getById(id)
  const sourceKind = payloads.map((payload) => payload.sourceKind).find(Boolean)
    ?? await findNodeKind(transaction, identity.sourceId)
  const targetKind = payloads.map((payload) => payload.targetKind).find(Boolean)
    ?? await findNodeKind(transaction, identity.targetId)
  if (!sourceKind || !targetKind) throw new Error("Graph relationship endpoints must exist: " + id + ".")
  const expected = hash(stableStringify({
    kind: identity.kind,
    sourceId: identity.sourceId,
    targetId: identity.targetId,
    props,
  }))
  if (current && edgeFingerprint(current, identity.kind) === expected) {
    summary.unchanged += 1
    return
  }
  await collection.bulkUpsertById([{
    id,
    from: { kind: sourceKind, id: identity.sourceId },
    to: { kind: targetKind, id: identity.targetId },
    props,
  }])
  if (current) summary.updatedEdges += 1
  else summary.createdEdges += 1
}

async function deleteNode(
  transaction: GraphTransaction,
  id: string,
  summary: GraphUpdateSummary,
): Promise<void> {
  const kind = await findNodeKind(transaction, id)
  if (!kind) return
  await nodeCollection(transaction, kind).bulkDelete([id])
  summary.deletedNodes += 1
}

async function materializeDocument(
  database: BetterSQLite3Database,
  key: string,
  owners: OwnershipRow[],
): Promise<void> {
  const selected = owners.at(-1)
  if (!selected) {
    await database.run(sql`DELETE FROM specta_documents WHERE key = ${key}`)
    return
  }
  const parsed = JSON.parse(selected.payload) as { value: unknown }
  await database.run(sql`INSERT INTO specta_documents(key, value)
    VALUES (${key}, ${JSON.stringify(parsed.value)})
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
}

async function readOwnersForIds(
  database: BetterSQLite3Database,
  type: EntityType,
  ids: Set<string>,
): Promise<Map<string, OwnershipRow[]>> {
  if (ids.size === 0) return new Map()
  const rows = await database.all<OwnershipRow>(sql`
    SELECT projection_key, entity_type, entity_id, entity_kind, priority, fingerprint, payload
    FROM specta_projection_ownership
    WHERE entity_type = ${type} AND entity_id IN (${sql.join([...ids].map((id) => sql`${id}`), sql`, `)})
    ORDER BY entity_id ASC, priority ASC, projection_key ASC
  `)
  const byId = new Map<string, OwnershipRow[]>()
  for (const row of rows) byId.set(row.entity_id, [...(byId.get(row.entity_id) ?? []), row])
  return byId
}

async function findNodeKind(
  transaction: GraphTransaction,
  id: string,
): Promise<WorkspaceGraphNodeKind | undefined> {
  for (const kind of workspaceGraphNodeKinds) {
    if (await nodeCollection(transaction, kind).getById(id)) return kind
  }
  return undefined
}

async function findEdgeKind(
  transaction: GraphTransaction,
  id: string,
): Promise<WorkspaceGraphEdgeKind | undefined> {
  for (const kind of workspaceGraphEdgeKinds) {
    if (await edgeCollection(transaction, kind).getById(id)) return kind
  }
  return undefined
}

function nodeCollection(transaction: GraphTransaction, kind: string): DynamicNodeCollection {
  const collection = transaction.getNodeCollection(kind)
  if (!collection) throw new Error("Unknown graph node kind: " + kind + ".")
  return collection
}

function edgeCollection(transaction: GraphTransaction, kind: string): DynamicEdgeCollection {
  if (!workspaceGraphEdgeKinds.includes(kind as WorkspaceGraphEdgeKind)) {
    throw new Error("Unknown graph edge kind: " + kind + ".")
  }
  return transaction.edges[kind as WorkspaceGraphEdgeKind] as unknown as DynamicEdgeCollection
}

function parseNodePayload(value: string): StoredNodePayload {
  return JSON.parse(value) as StoredNodePayload
}

function parseEdgePayload(value: string): StoredEdgePayload {
  return JSON.parse(value) as StoredEdgePayload
}

function affectedIds(type: EntityType, desired: DesiredOwnership[], stale: OwnershipRow[]): Set<string> {
  return new Set([
    ...desired.filter((owner) => owner.type === type).map((owner) => owner.id),
    ...stale.filter((owner) => owner.entity_type === type).map((owner) => owner.entity_id),
  ])
}

function ownershipKey(owner: Pick<DesiredOwnership, "type" | "id">): string {
  return owner.type + ":" + owner.id
}

function validateProjection(projection: GraphProjection): void {
  if (!projection.key.trim()) throw new Error("Graph projection key is required.")
  if (projection.priority !== undefined && !Number.isSafeInteger(projection.priority)) {
    throw new Error("Graph projection priority must be a safe integer.")
  }
  ensureUnique(projection.nodes.map((node) => node.id), "node IDs")
  ensureUnique(projection.edges.map((edge) => edge.id), "edge IDs")
  ensureUnique((projection.documents ?? []).map((document) => document.key), "document keys")
}

function ensureUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error("Graph projection " + label + " must be unique.")
}

function nodeFingerprint(value: Record<string, unknown>, kind: WorkspaceGraphNodeKind): string {
  const { id: _id, kind: _kind, meta: _meta, ...props } = value
  return hash(stableStringify({ kind, props }))
}

function edgeFingerprint(value: Record<string, unknown>, kind: WorkspaceGraphEdgeKind): string {
  const { id: _id, kind: _kind, meta: _meta, fromId, toId, fromKind: _fromKind, toKind: _toKind, ...props } = value
  return hash(stableStringify({ kind, sourceId: fromId, targetId: toId, props }))
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]"
  if (value !== null && typeof value === "object") {
    return "{" + Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => JSON.stringify(key) + ":" + stableStringify(item)).join(",") + "}"
  }
  return JSON.stringify(value) ?? "null"
}

/** Creates a stable ID for a relationship whose endpoints are already stable. */
export function createGraphEdgeId(edge: Pick<GraphEdgeUpsert, "kind" | "sourceId" | "targetId">): string {
  return "edge_" + createHash("sha256")
    .update(edge.kind + ":" + edge.sourceId + ":" + edge.targetId)
    .digest("hex").slice(0, 16)
}

/** Adds the canonical stable ID to a graph relationship upsert. */
export function createGraphEdge(edge: Omit<GraphEdgeUpsert, "id">): GraphEdgeUpsert {
  return { ...edge, id: createGraphEdgeId(edge) }
}
