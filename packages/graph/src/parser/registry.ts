import { extname } from "node:path"
import type { LanguageParser, ParserRegistry, SpecificationParser } from "./contracts.ts"

/** Creates an immutable parser registry and rejects ambiguous extension ownership. */
export function createParserRegistry(options: {
  specificationParsers: readonly SpecificationParser[]
  languageParsers: readonly LanguageParser[]
}): ParserRegistry {
  const specifications = indexParsers(options.specificationParsers)
  const languages = indexParsers(options.languageParsers)
  return {
    specificationParser: (path) => specifications.get(normalizedExtension(path)),
    languageParser: (path) => languages.get(normalizedExtension(path)),
  }
}

function indexParsers<T extends { extensions: readonly string[] }>(parsers: readonly T[]): Map<string, T> {
  const result = new Map<string, T>()
  for (const parser of parsers) {
    for (const extension of parser.extensions) {
      const normalized = extension.toLowerCase().replace(/^\.?/, ".")
      if (result.has(normalized)) throw new Error("Multiple parsers registered for " + normalized + ".")
      result.set(normalized, parser)
    }
  }
  return result
}

function normalizedExtension(path: string): string {
  return extname(path).toLowerCase()
}

