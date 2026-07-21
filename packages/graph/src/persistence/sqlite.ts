import Database from "better-sqlite3"
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { sql } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import { createSqliteBackend, generateSqliteMigrationSQL } from "@nicia-ai/typegraph/sqlite"
import { createStoreWithSchema, type Store, type TransactionContext } from "@nicia-ai/typegraph"
import type { Workspace } from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { nodeFileSystem } from "@specta/core/filesystem"
import { workspaceGraph, workspaceGraphNodeKinds } from "../ontology.ts"
import { createWorkspaceGraphQueries } from "../queries/index.ts"
import type {
  GraphProjection,
  WorkspaceGraphProvider,
  WorkspaceGraphSession,
  WorkspaceGraphTransaction,
} from "../repository/contracts.ts"
import { applyGraphProjection, createGraphEdgeId } from "../updates/apply-projection.ts"
import { spectaPersistenceSchemaSql } from "./schema.ts"
import { collectLegacyGraphProjections } from "./legacy-import.ts"

type GraphStore = Store<typeof workspaceGraph>
const typeGraphMigrationSql = generateSqliteMigrationSQL()

export const WORKSPACE_GRAPH_DATABASE = "workspace.sqlite"

/** Returns the canonical SQLite database path for a Workspace. */
export function workspaceGraphDatabasePath(workspace: Workspace): string {
  return join(workspace.rootPath, ".specta", "graph", WORKSPACE_GRAPH_DATABASE)
}

/** Configuration for the canonical SQLite Workspace Graph provider. */
export interface SqliteWorkspaceGraphProviderOptions {
  databasePath?: (workspace: Workspace) => string
  fileSystem?: FileSystem
}

/** Creates the TypeGraph/SQLite provider used by all graph repositories. */
export function createSqliteWorkspaceGraphProvider(
  options: SqliteWorkspaceGraphProviderOptions = {},
): WorkspaceGraphProvider {
  const fileSystem = options.fileSystem ?? nodeFileSystem
  const initializedPaths = new Set<string>()
  return {
    async withGraph(workspace, operation) {
      const path = options.databasePath?.(workspace) ?? workspaceGraphDatabasePath(workspace)
      if (path !== ":memory:") await mkdir(dirname(path), { recursive: true })
      const sqlite = new Database(path)
      let store: GraphStore | undefined
      try {
        sqlite.pragma("foreign_keys = ON")
        sqlite.pragma("busy_timeout = 5000")
        if (path !== ":memory:") sqlite.pragma("journal_mode = WAL")
        if (path === ":memory:" || !initializedPaths.has(path)) {
          sqlite.exec(typeGraphMigrationSql)
          sqlite.exec(spectaPersistenceSchemaSql)
          if (path !== ":memory:") initializedPaths.add(path)
        }
        const backend = createSqliteBackend(drizzle(sqlite))
        const created = await createStoreWithSchema(workspaceGraph, backend)
        store = created[0]
        const session = createSession(store, sqlite)
        await seedWorkspace(session, workspace)
        await importLegacyGraph(store, sqlite, workspace, fileSystem)
        return await operation(session)
      } finally {
        try {
          if (store) await store.close()
        } finally {
          sqlite.close()
        }
      }
    },
  }
}

async function importLegacyGraph(
  store: GraphStore,
  sqlite: Database.Database,
  workspace: Workspace,
  fileSystem: FileSystem,
): Promise<void> {
  const marker = sqlite.prepare("SELECT value FROM specta_metadata WHERE key = 'legacy-import-v1'").get()
  if (marker) return
  const projections = await collectLegacyGraphProjections(workspace, fileSystem)
  await store.transaction(async (transaction) => {
    for (const projection of projections) await applyGraphProjection(transaction, projection)
    const database = transaction.sql as BetterSQLite3Database
    await database.run(sql`INSERT INTO specta_metadata(key, value)
      VALUES ('legacy-import-v1', 'complete')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
  })
}

function createSession(store: GraphStore, sqlite: Database.Database): WorkspaceGraphSession {
  const readDocument = async <T>(key: string): Promise<T | null> => {
    const row = sqlite.prepare("SELECT value FROM specta_documents WHERE key = ?").get(key) as { value: string } | undefined
    return row ? JSON.parse(row.value) as T : null
  }
  const runTransaction = <T>(operation: (graph: WorkspaceGraphTransaction) => Promise<T>): Promise<T> =>
    store.transaction(async (transaction) => operation(createTransactionSession(transaction)))
  const applyMany = (projections: GraphProjection[]) =>
    runTransaction((graph) => graph.projections.applyMany(projections))
  return {
    readDocument,
    queries: createWorkspaceGraphQueries(store, async (id) => {
      const row = sqlite.prepare(`SELECT entity_kind
        FROM specta_projection_ownership
        WHERE entity_type = 'node' AND entity_id = ? AND entity_kind IS NOT NULL
        ORDER BY priority DESC, projection_key DESC LIMIT 1`).get(id) as { entity_kind: string } | undefined
      return row && workspaceGraphNodeKinds.includes(row.entity_kind as typeof workspaceGraphNodeKinds[number])
        ? row.entity_kind as typeof workspaceGraphNodeKinds[number]
        : undefined
    }),
    transaction: runTransaction,
    projections: {
      apply: async (projection) => (await applyMany([projection]))[0]!,
      applyMany,
    },
  }
}

function createTransactionSession(
  transaction: TransactionContext<typeof workspaceGraph>,
): WorkspaceGraphTransaction {
  const applyMany = async (projections: GraphProjection[]) => {
    const summaries = []
    for (const projection of projections) summaries.push(await applyGraphProjection(transaction, projection))
    return summaries
  }
  return {
    readDocument: async <T>(key: string): Promise<T | null> => {
      const database = transaction.sql as BetterSQLite3Database
      const rows = await database.all<{ value: string }>(sql`
        SELECT value FROM specta_documents WHERE key = ${key} LIMIT 1
      `)
      return rows[0] ? JSON.parse(rows[0].value) as T : null
    },
    projections: {
      apply: async (projection) => (await applyMany([projection]))[0]!,
      applyMany,
    },
  }
}

async function seedWorkspace(session: WorkspaceGraphSession, workspace: Workspace): Promise<void> {
  const current = await session.readDocument<Workspace>("workspace-manifest")
  if (current !== null && JSON.stringify(current) === JSON.stringify(workspace)) return
  const nodes: GraphProjection["nodes"] = [{
    id: workspace.id,
    kind: "Workspace",
    props: { createdAt: workspace.createdAt, packageManager: workspace.packageManager },
  }, ...workspace.projects.map((project) => ({
    id: project.id,
    kind: "Project" as const,
    props: { name: project.name, rootPath: project.rootPath, projectKind: project.kind, manifestPath: project.manifestPath },
  }))]
  const edges = workspace.projects.map((project) => {
    const relationship = { kind: "CONTAINS" as const, sourceId: workspace.id, targetId: project.id }
    return {
      ...relationship,
      id: createGraphEdgeId(relationship),
      sourceKind: "Workspace" as const,
      targetKind: "Project" as const,
    }
  })
  await session.projections.apply({
    key: "workspace",
    priority: 100,
    nodes,
    edges,
    documents: [{ key: "workspace-manifest", value: workspace }],
  })
}
