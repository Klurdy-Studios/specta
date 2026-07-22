import { createRequire } from "node:module"
import type * as TypeScript from "typescript"
import type { ProjectProfile, TechnicalFile, ValidationResult } from "@specta/core"

const require = createRequire(import.meta.url)
let compiler: typeof TypeScript | undefined

export interface LanguageAdapter {
  readonly language: string
  validateDesign(files: TechnicalFile[], profile: ProjectProfile): ValidationResult
  validateFile(
    file: TechnicalFile,
    content: string,
    options?: { declarationOnly?: boolean; validateSignatures?: boolean },
  ): ValidationResult
  /** Compares a designed declaration with an analyzed declaration using language semantics. */
  signaturesCompatible(expected: string, actual: string): boolean
}

export interface LanguageAdapterRegistry {
  resolve(language: string): LanguageAdapter
}

export function createLanguageAdapterRegistry(
  adapters: LanguageAdapter[] = [typeScriptLanguageAdapter],
): LanguageAdapterRegistry {
  const indexed = new Map(adapters.map((adapter) => [adapter.language, adapter]))
  return {
    resolve(language) {
      const adapter = indexed.get(language)
      if (adapter === undefined) throw new Error("No language adapter is registered for " + language + ".")
      return adapter
    },
  }
}

export const typeScriptLanguageAdapter: LanguageAdapter = {
  language: "typescript",
  validateDesign(files, profile) {
    const issues = files.flatMap((file) => {
      if (file.language !== "typescript") return ["File " + file.path + " requires unsupported language " + file.language + "."]
      if (!/\.(?:ts|tsx)$/.test(file.path) && file.kind !== "configuration") {
        return ["TypeScript source file must end in .ts or .tsx: " + file.path + "."]
      }
      return []
    })
    return validation(issues, "Technical Design is compatible with the " + profile.framework + " project profile.")
  },
  validateFile(file, content, options = {}) {
    const ts = typescript()
    if (file.path.endsWith(".json")) {
      try {
        JSON.parse(content)
        return validation([], "Configuration JSON is valid.")
      } catch {
        return validation(["Configuration file is not valid JSON: " + file.path + "."], "")
      }
    }
    const source = ts.createSourceFile(file.path, content, ts.ScriptTarget.Latest, true, file.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const diagnostics = (source as TypeScript.SourceFile & { parseDiagnostics: readonly TypeScript.Diagnostic[] }).parseDiagnostics
    const issues = diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
    const exports = exportedDeclarations(source)
    for (const symbol of file.exports) {
      const declaration = exports.get(symbol.name)
      if (declaration === undefined) {
        issues.push("Missing declared export " + symbol.name + " in " + file.path + ".")
        continue
      }
      if (declaration.kind !== "unknown" && declaration.kind !== symbol.kind) {
        issues.push("Export " + symbol.name + " must be declared as " + symbol.kind + " in " + file.path + ".")
      }
      if (options.validateSignatures !== false
        && symbol.signature !== undefined
        && !typeScriptSignaturesCompatible(symbol.signature, declaration.text)) {
        issues.push("Export " + symbol.name + " does not match its approved signature in " + file.path + ".")
      }
    }
    if (options.declarationOnly !== false) inspectExecutableBodies(source, issues)
    return validation(issues, "TypeScript declarations are valid.")
  },
  signaturesCompatible: typeScriptSignaturesCompatible,
}

function exportedDeclarations(source: TypeScript.SourceFile): Map<string, { kind: string, text: string }> {
  const ts = typescript()
  const declarations = new Map<string, { kind: string, text: string }>()
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        declarations.set(element.name.text, { kind: "unknown", text: element.getText(source) })
      }
      continue
    }
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue
    const named = statement as TypeScript.Statement & { name?: TypeScript.DeclarationName }
    if (named.name && ts.isIdentifier(named.name)) {
      declarations.set(named.name.text, { kind: declarationKind(statement), text: statement.getText(source) })
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          declarations.set(declaration.name.text, { kind: "constant", text: statement.getText(source) })
        }
      }
    }
  }
  return declarations
}

function declarationKind(statement: TypeScript.Statement): string {
  const ts = typescript()
  if (ts.isClassDeclaration(statement)) return "class"
  if (ts.isInterfaceDeclaration(statement)) return "interface"
  if (ts.isFunctionDeclaration(statement)) return "function"
  if (ts.isTypeAliasDeclaration(statement)) return "type"
  return "unknown"
}

function inspectExecutableBodies(node: TypeScript.Node, issues: string[]): void {
  const ts = typescript()
  if (ts.isFunctionDeclaration(node) && node.body !== undefined) issues.push("Function bodies are not allowed in declaration-only scaffolds.")
  if ((ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)) && node.body !== undefined) {
    issues.push("Method bodies are not allowed in declaration-only scaffolds.")
  }
  if (ts.isVariableDeclaration(node) && node.initializer !== undefined) issues.push("Variable initializers are not allowed in declaration-only scaffolds.")
  if (ts.isPropertyDeclaration(node) && node.initializer !== undefined) issues.push("Property initializers are not allowed in declaration-only scaffolds.")
  if ((ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && node.body !== undefined) {
    issues.push("Accessor bodies are not allowed in declaration-only scaffolds.")
  }
  if (ts.isClassStaticBlockDeclaration(node)) issues.push("Static blocks are not allowed in declaration-only scaffolds.")
  if (ts.isExpressionStatement(node)) issues.push("Top-level executable expressions are not allowed in declaration-only scaffolds.")
  if (ts.isImportDeclaration(node) && node.importClause === undefined) {
    issues.push("Side-effect imports are not allowed in declaration-only scaffolds.")
  }
  if (ts.isModuleDeclaration(node) || ts.isEnumDeclaration(node)) {
    issues.push("Runtime namespaces and enums are not allowed in declaration-only scaffolds.")
  }
  node.forEachChild((child) => inspectExecutableBodies(child, issues))
}

function hasModifier(node: TypeScript.Node, kind: TypeScript.SyntaxKind): boolean {
  const ts = typescript()
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false)
}

function typescript(): typeof TypeScript {
  compiler ??= require("typescript") as typeof TypeScript
  return compiler
}

function typeScriptSignaturesCompatible(expected: string, actual: string): boolean {
  return canonicalTypeScriptSignature(expected) === canonicalTypeScriptSignature(actual)
}

function canonicalTypeScriptSignature(value: string): string {
  const ts = typescript()
  const source = ts.createSourceFile("signature.ts", value, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const statement = source.statements[0]
  if (statement === undefined) return normalizeSignatureText(value)
  let text = statement.getText(source)
  if (ts.isFunctionDeclaration(statement) && statement.body !== undefined) {
    text = value.slice(statement.getStart(source), statement.body.getStart(source))
  } else if (ts.isVariableStatement(statement)) {
    const declaration = statement.declarationList.declarations[0]
    if (declaration !== undefined) {
      const keyword = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0 ? "const"
        : (statement.declarationList.flags & ts.NodeFlags.Let) !== 0 ? "let" : "var"
      text = keyword + " " + declaration.name.getText(source)
        + (declaration.type === undefined ? "" : ":" + declaration.type.getText(source))
    }
  }
  return normalizeSignatureText(text)
}

function normalizeSignatureText(value: string): string {
  return value
    .replace(/^\s*export\s+/, "")
    .replace(/^\s*declare\s+/, "")
    .replace(/;\s*$/, "")
    .replace(/\s+/g, "")
}

function validation(issues: string[], success: string): ValidationResult {
  return issues.length === 0
    ? { valid: true, issues: [], summary: success }
    : { valid: false, issues, summary: issues.length + " validation issue(s)." }
}
