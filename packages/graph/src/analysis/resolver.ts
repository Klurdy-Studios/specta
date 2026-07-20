import { posix } from "node:path"
import { normalizePath } from "./identifiers.ts"

export type ModuleResolution =
  | { kind: "workspace-file"; path: string }
  | { kind: "external"; packageName: string }
  | { kind: "unresolved"; specifier: string }

/** Resolves relative TypeScript imports against the complete discovered file set. */
export function resolveTypeScriptModule(
  importingPath: string,
  specifier: string,
  knownPaths: ReadonlySet<string>,
): ModuleResolution {
  if (!specifier.startsWith(".")) {
    const packageName = externalPackageName(specifier)
    return packageName ? { kind: "external", packageName } : { kind: "unresolved", specifier }
  }
  const base = normalizePath(posix.join(posix.dirname(normalizePath(importingPath)), specifier))
  const sourceBase = base.replace(/\.jsx?$/, "").replace(/\.mjs$/, ".mts").replace(/\.cjs$/, ".cts")
  const candidates = [base, sourceBase, sourceBase + ".ts", sourceBase + ".tsx", sourceBase + ".mts", sourceBase + ".cts", ...[
    "index.ts", "index.tsx", "index.mts", "index.cts",
  ].map((name) => posix.join(sourceBase, name))]
  const resolved = candidates.find((candidate) => knownPaths.has(candidate))
  return resolved ? { kind: "workspace-file", path: resolved } : { kind: "unresolved", specifier }
}

function externalPackageName(specifier: string): string | undefined {
  const segments = specifier.split("/")
  if (!segments[0]) return undefined
  return specifier.startsWith("@") && segments[1] ? segments.slice(0, 2).join("/") : segments[0]
}
