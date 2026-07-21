import Parser from "tree-sitter"
import TypeScriptLanguages from "tree-sitter-typescript"
import type {
  ParsedCodeSymbol,
  ParsedExport,
  ParsedImport,
  ParsedSourceFile,
  ParsedTest,
  ParseDiagnostic,
  SourceLocation,
  TechnicalSymbolKind,
} from "@specta/core"
import type { LanguageParser, ParserInput } from "./contracts.ts"
import { createTypeScriptModuleResolver } from "./typescript-resolver.ts"

const declarationKinds: Readonly<Record<string, TechnicalSymbolKind>> = {
  class_declaration: "class",
  interface_declaration: "interface",
  function_declaration: "function",
  function_signature: "function",
  type_alias_declaration: "type",
}

let typescriptParser: Parser | undefined
let tsxParser: Parser | undefined

/** Tree-sitter parser for TypeScript and TSX source files. */
export const typeScriptLanguageParser: LanguageParser = {
  language: "typescript",
  extensions: [".ts", ".tsx", ".mts", ".cts"],
  createModuleResolver: createTypeScriptModuleResolver,
  parse(input): ParsedSourceFile {
    const parser = parserFor(input.path)
    const tree = parser.parse(input.content)
    const root = tree.rootNode
    const imports: ParsedImport[] = []
    const exports: ParsedExport[] = []
    const symbols: ParsedCodeSymbol[] = []
    const tests: ParsedTest[] = []
    const diagnostics: ParseDiagnostic[] = []
    const framework = detectTestFramework(input.content)

    for (const node of root.namedChildren) {
      if (node.type === "import_statement") imports.push(parseImport(node, input.path))
      if (node.type === "export_statement") {
        const exportStart = exports.length
        parseExportStatement(node, input.path, symbols, exports)
        const source = node.childForFieldName("source")
        if (source) {
          imports.push({
            specifier: unquote(source.text),
            bindings: exports.slice(exportStart).map((item) => item.localName ?? item.name),
            bindingMappings: exports.slice(exportStart).map((item) => ({
              imported: item.localName ?? item.name,
              local: item.localName ?? item.name,
            })),
            typeOnly: /^export\s+type\b/.test(node.text),
            location: nodeLocation(input.path, node),
          })
        }
      } else {
        symbols.push(...parseDeclaration(node, input.path, false))
      }
    }

    const symbolNames = new Set([
      ...symbols.map((symbol) => symbol.name),
      ...imports.flatMap((imported) => imported.bindings),
    ])
    walk(root, (node) => {
      if (node.type === "ERROR" || node.isMissing) {
        diagnostics.push({
          code: "TS_SYNTAX",
          severity: "error",
          message: node.isMissing ? "Missing " + node.type + "." : "Unrecognized TypeScript syntax.",
          location: nodeLocation(input.path, node),
        })
      }
      if (node.type === "call_expression") {
        const dynamicImport = parseDynamicImport(node, input.path)
        if (dynamicImport) imports.push(dynamicImport)
        const parsedTest = parseTest(node, input.path, framework, symbolNames)
        if (parsedTest) tests.push(parsedTest)
      }
    })

    const value: ParsedSourceFile = {
      path: input.path,
      language: "typescript",
      imports,
      exports,
      symbols,
      tests,
      diagnostics,
    }
    if (input.projectId) value.projectId = input.projectId
    return value
  },
}

function parserFor(path: string): Parser {
  if (path.toLowerCase().endsWith(".tsx")) {
    if (!tsxParser) {
      tsxParser = new Parser()
      tsxParser.setLanguage(TypeScriptLanguages.tsx)
    }
    return tsxParser
  }
  if (!typescriptParser) {
    typescriptParser = new Parser()
    typescriptParser.setLanguage(TypeScriptLanguages.typescript)
  }
  return typescriptParser
}

function parseImport(node: Parser.SyntaxNode, path: string): ParsedImport {
  const source = node.childForFieldName("source")
  const clause = node.namedChildren.find((child) => child.type === "import_clause")
  const bindingMappings = clause ? importBindingMappings(clause) : []
  return {
    specifier: unquote(source?.text ?? ""),
    bindings: bindingMappings.map((binding) => binding.local),
    bindingMappings,
    typeOnly: /^import\s+type\b/.test(node.text),
    location: nodeLocation(path, node),
  }
}

function importBindingMappings(clause: Parser.SyntaxNode): Array<{ imported: string; local: string }> {
  const bindings: Array<{ imported: string; local: string }> = []
  for (const child of clause.namedChildren) {
    if (child.type === "identifier") bindings.push({ imported: "default", local: child.text })
    if (child.type === "namespace_import") {
      const identifier = child.namedChildren.find((candidate) => candidate.type === "identifier")
      if (identifier) bindings.push({ imported: "*", local: identifier.text })
    }
    if (child.type === "named_imports") {
      for (const specifier of child.namedChildren.filter((candidate) => candidate.type === "import_specifier")) {
        const binding = specifier.childForFieldName("alias") ?? specifier.childForFieldName("name")
        const imported = specifier.childForFieldName("name")
        if (binding && imported) bindings.push({ imported: imported.text, local: binding.text })
      }
    }
  }
  return [...new Map(bindings.map((binding) => [binding.imported + ":" + binding.local, binding])).values()]
}

function parseExportStatement(
  node: Parser.SyntaxNode,
  path: string,
  symbols: ParsedCodeSymbol[],
  exports: ParsedExport[],
): void {
  const source = node.childForFieldName("source")
  const sourceSpecifier = source ? unquote(source.text) : undefined
  const defaultExport = /^export\s+default\b/.test(node.text)
  const declaration = node.childForFieldName("declaration")
  if (declaration) {
    const parsed = parseDeclaration(declaration, path, true)
    symbols.push(...parsed)
    for (const symbol of parsed) {
      exports.push({
        name: defaultExport ? "default" : symbol.name,
        ...(defaultExport ? { localName: symbol.name } : {}),
        typeOnly: symbol.kind === "type" || symbol.kind === "interface",
        location: symbol.location,
      })
    }
  }
  const clause = node.namedChildren.find((child) => child.type === "export_clause")
  for (const specifier of clause?.namedChildren ?? []) {
    if (specifier.type !== "export_specifier") continue
    const exported = specifier.childForFieldName("alias") ?? specifier.childForFieldName("name")
    const local = specifier.childForFieldName("name")
    if (exported) {
      exports.push({
        name: exported.text,
        ...(local && local.text !== exported.text ? { localName: local.text } : {}),
        ...(sourceSpecifier ? { source: sourceSpecifier } : {}),
        typeOnly: /^export\s+type\b/.test(node.text) || /^type\b/.test(specifier.text),
        location: nodeLocation(path, specifier),
      })
    }
  }
  if (defaultExport && !declaration) {
    const value = node.childForFieldName("value")
    if (value) {
      const kind = value.type === "class" ? "class" as const
        : value.type === "arrow_function" || value.type === "function_expression" ? "function" as const
        : "constant" as const
      const body = value.childForFieldName("body")
      symbols.push({
        name: "default",
        kind,
        exported: true,
        signature: body ? "default " + textBefore(value.text, body.text) : "default",
        hasBody: kind === "class" || kind === "function",
        location: nodeLocation(path, value),
      })
    }
    exports.push({ name: "default", typeOnly: false, location: nodeLocation(path, node) })
  }
}

function parseDynamicImport(node: Parser.SyntaxNode, path: string): ParsedImport | undefined {
  const callable = node.childForFieldName("function")?.text
  if (callable !== "import" && callable !== "require") return undefined
  const argument = node.childForFieldName("arguments")?.namedChildren[0]
  if (!argument || argument.type !== "string") return undefined
  return {
    specifier: unquote(argument.text),
    bindings: [],
    typeOnly: false,
    location: nodeLocation(path, node),
  }
}

function parseDeclaration(node: Parser.SyntaxNode, path: string, exported: boolean): ParsedCodeSymbol[] {
  if (node.type === "lexical_declaration") {
    const declarationKeyword = node.text.match(/^\s*(const|let|var)\b/)?.[1] ?? "const"
    return node.namedChildren
      .filter((child) => child.type === "variable_declarator")
      .flatMap((declarator) => {
        const name = declarator.childForFieldName("name")
        if (!name || name.type !== "identifier") return []
        const value = declarator.childForFieldName("value")
        const type = declarator.childForFieldName("type")
        return [{
          name: name.text,
          kind: "constant" as const,
          exported,
          signature: declarationKeyword + " " + name.text + (type ? type.text : ""),
          hasBody: value?.type === "arrow_function" || value?.type === "function_expression",
          location: nodeLocation(path, declarator),
        }]
      })
  }
  const kind = declarationKinds[node.type]
  if (!kind) return []
  const name = node.childForFieldName("name")
  if (!name) return []
  const body = node.childForFieldName("body")
  const executableBody = kind === "class" || kind === "function" ? body : null
  return [{
    name: name.text,
    kind,
    exported,
    signature: executableBody ? textBefore(node.text, executableBody.text) : node.text.trim(),
    hasBody: kind === "class" || kind === "function" ? body !== null : false,
    location: nodeLocation(path, node),
  }]
}

function parseTest(
  node: Parser.SyntaxNode,
  path: string,
  framework: ParsedTest["framework"],
  knownSymbols: ReadonlySet<string>,
): ParsedTest | undefined {
  const callable = node.childForFieldName("function")?.text ?? ""
  if (!/^(?:describe|it|test)(?:\.(?:only|skip|todo|each))?$/.test(callable)) return undefined
  const firstArgument = node.childForFieldName("arguments")?.namedChildren[0]
  if (!firstArgument || !["string", "template_string"].includes(firstArgument.type)) return undefined
  const referencedSymbols = new Set<string>()
  walk(node, (descendant) => {
    if (descendant.type === "identifier" && knownSymbols.has(descendant.text)) referencedSymbols.add(descendant.text)
  })
  return {
    name: unquote(firstArgument.text),
    framework,
    testedSymbols: [...referencedSymbols].sort(),
    location: nodeLocation(path, node),
  }
}

function detectTestFramework(content: string): ParsedTest["framework"] {
  if (/from\s+["']vitest["']|require\(["']vitest["']\)/.test(content)) return "vitest"
  if (/from\s+["'](?:@jest\/globals|jest)["']|require\(["']jest["']\)/.test(content)) return "jest"
  if (/from\s+["']node:test["']|require\(["']node:test["']\)/.test(content)) return "node"
  return "unknown"
}

function walk(node: Parser.SyntaxNode, visit: (node: Parser.SyntaxNode) => void): void {
  visit(node)
  for (const child of node.namedChildren) walk(child, visit)
}

function nodeLocation(path: string, node: Parser.SyntaxNode): SourceLocation {
  return {
    path,
    start: { line: node.startPosition.row + 1, column: node.startPosition.column },
    end: { line: node.endPosition.row + 1, column: node.endPosition.column },
  }
}

function unquote(value: string): string {
  return value.replace(/^["'`]|["'`]$/g, "")
}

function textBefore(text: string, suffix: string): string {
  const index = text.lastIndexOf(suffix)
  return (index < 0 ? text : text.slice(0, index)).trim()
}
