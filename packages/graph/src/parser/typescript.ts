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
import type { LanguageParser, ParserInput, ParseResult } from "./contracts.ts"

const declarationKinds: Readonly<Record<string, TechnicalSymbolKind>> = {
  class_declaration: "class",
  interface_declaration: "interface",
  function_declaration: "function",
  function_signature: "function",
  type_alias_declaration: "type",
}

/** Tree-sitter parser for TypeScript and TSX source files. */
export const typeScriptLanguageParser: LanguageParser = {
  language: "typescript",
  extensions: [".ts", ".tsx", ".mts", ".cts"],
  parse(input): ParseResult<ParsedSourceFile> {
    const parser = new Parser()
    parser.setLanguage((input.path.toLowerCase().endsWith(".tsx")
      ? TypeScriptLanguages.tsx
      : TypeScriptLanguages.typescript) as Parser.Language)
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
        parseExportStatement(node, input.path, symbols, exports)
        const source = node.childForFieldName("source")
        if (source) {
          imports.push({
            specifier: unquote(source.text),
            bindings: [],
            typeOnly: /^export\s+type\b/.test(node.text),
            location: nodeLocation(input.path, node),
          })
        }
      } else {
        symbols.push(...parseDeclaration(node, input.path, false))
      }
    }

    const symbolNames = new Set(symbols.map((symbol) => symbol.name))
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
    return { value, diagnostics }
  },
}

function parseImport(node: Parser.SyntaxNode, path: string): ParsedImport {
  const source = node.childForFieldName("source")
  const clause = node.namedChildren.find((child) => child.type === "import_clause")
  return {
    specifier: unquote(source?.text ?? ""),
    bindings: clause ? importBindings(clause) : [],
    typeOnly: /^import\s+type\b/.test(node.text),
    location: nodeLocation(path, node),
  }
}

function importBindings(clause: Parser.SyntaxNode): string[] {
  const bindings: string[] = []
  for (const child of clause.namedChildren) {
    if (child.type === "identifier") bindings.push(child.text)
    if (child.type === "namespace_import") {
      const identifier = child.namedChildren.find((candidate) => candidate.type === "identifier")
      if (identifier) bindings.push(identifier.text)
    }
    if (child.type === "named_imports") {
      for (const specifier of child.namedChildren.filter((candidate) => candidate.type === "import_specifier")) {
        const binding = specifier.childForFieldName("alias") ?? specifier.childForFieldName("name")
        if (binding) bindings.push(binding.text)
      }
    }
  }
  return [...new Set(bindings)]
}

function parseExportStatement(
  node: Parser.SyntaxNode,
  path: string,
  symbols: ParsedCodeSymbol[],
  exports: ParsedExport[],
): void {
  const declaration = node.childForFieldName("declaration")
  if (declaration) {
    const parsed = parseDeclaration(declaration, path, true)
    symbols.push(...parsed)
    for (const symbol of parsed) {
      exports.push({ name: symbol.name, typeOnly: symbol.kind === "type" || symbol.kind === "interface", location: symbol.location })
    }
  }
  const clause = node.namedChildren.find((child) => child.type === "export_clause")
  for (const specifier of clause?.namedChildren ?? []) {
    if (specifier.type !== "export_specifier") continue
    const exported = specifier.childForFieldName("alias") ?? specifier.childForFieldName("name")
    if (exported) {
      exports.push({
        name: exported.text,
        typeOnly: /^export\s+type\b/.test(node.text) || /^type\b/.test(specifier.text),
        location: nodeLocation(path, specifier),
      })
    }
  }
  if (/^export\s+default\b/.test(node.text) && !declaration) {
    exports.push({ name: "default", typeOnly: false, location: nodeLocation(path, node) })
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
