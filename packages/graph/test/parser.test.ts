import { describe, expect, it } from "vitest"
import { markdownSpecificationParser, typeScriptLanguageParser } from "../src/parser/index.ts"

describe("Markdown specification parser", () => {
  it("extracts explicit planning entities and their source locations", () => {
    const result = markdownSpecificationParser.parse({
      path: ".spec/epics/004.md",
      content: [
        "# Epic 004 — Analysis",
        "## Requirements",
        "- Parse Markdown deterministically.",
        "## Story 1: Compile a workspace",
        "### Acceptance Criteria",
        "- Graph nodes are persisted.",
        "### Tasks",
        "- Add a compile command.",
      ].join("\n"),
    })

    expect(result.value.title).toBe("Epic 004 — Analysis")
    expect(result.value.entities.map(({ kind, title, parentTitle }) => ({ kind, title, parentTitle }))).toEqual([
      { kind: "epic", title: "Analysis", parentTitle: undefined },
      { kind: "requirement", title: "Parse Markdown deterministically.", parentTitle: undefined },
      { kind: "story", title: "Compile a workspace", parentTitle: "Analysis" },
      { kind: "acceptance-criterion", title: "Graph nodes are persisted.", parentTitle: "Compile a workspace" },
      { kind: "task", title: "Add a compile command.", parentTitle: "Compile a workspace" },
    ])
    expect(result.value.entities[1]?.location.start.line).toBe(3)
  })
})

describe("TypeScript language parser", () => {
  it("extracts imports, exports, symbols and tests without function bodies", () => {
    const result = typeScriptLanguageParser.parse({
      path: "src/service.test.ts",
      content: [
        'import { describe, expect, it } from "vitest"',
        'import type { Input } from "./types"',
        "export interface Service { run(input: Input): string }",
        "export function createService(input: Input): Service { return { run: () => String(input) } }",
        'describe("service", () => { it("runs", () => expect(createService({} as Input).run({} as Input)).toBeTruthy()) })',
      ].join("\n"),
    })

    expect(result.value.imports).toMatchObject([
      { specifier: "vitest", bindings: ["describe", "expect", "it"], typeOnly: false },
      { specifier: "./types", bindings: ["Input"], typeOnly: true },
    ])
    expect(result.value.symbols.map((symbol) => [symbol.name, symbol.kind, symbol.exported])).toEqual([
      ["Service", "interface", true],
      ["createService", "function", true],
    ])
    expect(result.value.symbols[0]?.signature).toContain("run(input: Input): string")
    expect(result.value.symbols[1]?.signature).not.toContain("return")
    expect(result.value.tests.map((test) => test.name)).toEqual(["service", "runs"])
    expect(result.value.tests.every((test) => test.framework === "vitest")).toBe(true)
    expect(result.value.tests.every((test) => test.testedSymbols.includes("createService"))).toBe(true)
  })

  it("reports invalid syntax with locations", () => {
    const result = typeScriptLanguageParser.parse({ path: "src/broken.ts", content: "export const =" })
    expect(result.diagnostics[0]).toMatchObject({ code: "TS_SYNTAX", severity: "error" })
    expect(result.diagnostics[0]?.location?.path).toBe("src/broken.ts")
  })
})
