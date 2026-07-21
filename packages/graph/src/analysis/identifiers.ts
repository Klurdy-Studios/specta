import { createHash } from "node:crypto"
import { posix } from "node:path"

/** Creates a stable graph ID from a node kind and project-relative identity. */
export function createStableGraphId(kind: string, projectRoot: string, identity: string): string {
  const canonical = [normalizePath(projectRoot), normalizePath(identity)].join(":")
  return kind.toLowerCase() + "_" + createHash("sha256").update(kind.toUpperCase() + ":" + canonical).digest("hex").slice(0, 16)
}

/** Creates the canonical graph ID for one Technical Design module. */
export const createModuleGraphId = (projectRoot: string, path: string): string =>
  createStableGraphId("module", projectRoot, path)

/** Creates the canonical graph ID shared by Technical Designs and source analysis. */
export const createFileGraphId = (projectRoot: string, path: string): string =>
  createStableGraphId("file", projectRoot, path)

/** Creates the canonical graph ID for an exported symbol. */
export const createSymbolGraphId = (projectRoot: string, path: string, name: string): string =>
  createStableGraphId("symbol", projectRoot, path + "#" + name)

/** Normalizes filesystem paths to a portable workspace-relative representation. */
export function normalizePath(path: string): string {
  const normalized = posix.normalize(path.replaceAll("\\", "/"))
  return normalized === "" ? "." : normalized.replace(/^\.\//, "")
}

/** Normalizes human-authored titles for deterministic semantic matching. */
export function normalizeGraphTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ")
}
