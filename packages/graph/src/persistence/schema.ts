/** SQLite tables owned by Specta in addition to TypeGraph's canonical tables. */
export const spectaPersistenceSchemaSql = `
CREATE TABLE IF NOT EXISTS specta_projection_ownership (
  projection_key TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('node', 'edge', 'document')),
  entity_id TEXT NOT NULL,
  entity_kind TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  fingerprint TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (projection_key, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS specta_projection_entity_idx
  ON specta_projection_ownership(entity_type, entity_id, priority, projection_key);
CREATE TABLE IF NOT EXISTS specta_documents (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS specta_metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`
