import type {
  ParsedSourceFile,
  ParsedSpecification,
  ParseDiagnostic,
  ProjectId,
} from "@specta/core"

/** Source text and workspace-relative path supplied to a parser. */
export interface ParserInput {
  path: string
  content: string
  projectId?: ProjectId
}

/** A parsed value together with non-fatal diagnostics. */
export interface ParseResult<T> {
  value: T
  diagnostics: ParseDiagnostic[]
}

/** Parses one supported specification document. */
export interface SpecificationParser {
  readonly extensions: readonly string[]
  parse(input: ParserInput): ParseResult<ParsedSpecification>
}

/** Parses one supported programming-language source file. */
export interface LanguageParser {
  readonly language: string
  readonly extensions: readonly string[]
  parse(input: ParserInput): ParseResult<ParsedSourceFile>
}

/** Selects parsers by normalized file extension. */
export interface ParserRegistry {
  /** Returns the registered specification parser for a path, if supported. */
  specificationParser(path: string): SpecificationParser | undefined
  /** Returns the registered language parser for a path, if supported. */
  languageParser(path: string): LanguageParser | undefined
}
