import type {
  ParsedSourceFile,
  ParsedSpecification,
  ParsedImport,
  ProjectId,
  Workspace,
} from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"

/** Source text and workspace-relative path supplied to a parser. */
export interface ParserInput {
  path: string
  content: string
  projectId?: ProjectId
}

/** Parses one supported specification document. */
export interface SpecificationParser {
  readonly extensions: readonly string[]
  parse(input: ParserInput): ParsedSpecification
}

/** Parses one supported programming-language source file. */
export interface LanguageParser {
  readonly language: string
  readonly extensions: readonly string[]
  parse(input: ParserInput): ParsedSourceFile
  createModuleResolver?(context: ModuleResolverContext): Promise<ModuleResolver>
}

/** Workspace evidence available while preparing a language-specific resolver. */
export interface ModuleResolverContext {
  workspace: Workspace
  fileSystem: FileSystem
  knownPaths: ReadonlySet<string>
}

/** Resolves one parsed import without coupling graph orchestration to a language. */
export interface ModuleResolver {
  resolve(input: {
    importingPath: string
    specifier: string
    projectId?: ProjectId
  }): NonNullable<ParsedImport["resolution"]>
}

/** Selects parsers by normalized file extension. */
export interface ParserRegistry {
  /** Returns the registered specification parser for a path, if supported. */
  specificationParser(path: string): SpecificationParser | undefined
  /** Returns the registered language parser for a path, if supported. */
  languageParser(path: string): LanguageParser | undefined
}
