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

    expect(result.title).toBe("Epic 004 — Analysis")
    expect(result.entities.map(({ kind, title, parentTitle }) => ({ kind, title, parentTitle }))).toEqual([
      { kind: "epic", title: "Analysis", parentTitle: undefined },
      { kind: "requirement", title: "Parse Markdown deterministically.", parentTitle: undefined },
      { kind: "story", title: "Compile a workspace", parentTitle: "Analysis" },
      { kind: "acceptance-criterion", title: "Graph nodes are persisted.", parentTitle: "Compile a workspace" },
      { kind: "task", title: "Add a compile command.", parentTitle: "Compile a workspace" },
    ])
    expect(result.entities[1]?.location.start.line).toBe(3)
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

    expect(result.imports).toMatchObject([
      { specifier: "vitest", bindings: ["describe", "expect", "it"], typeOnly: false },
      { specifier: "./types", bindings: ["Input"], typeOnly: true },
    ])
    expect(result.symbols.map((symbol) => [symbol.name, symbol.kind, symbol.exported])).toEqual([
      ["Service", "interface", true],
      ["createService", "function", true],
    ])
    expect(result.symbols[0]?.signature).toContain("run(input: Input): string")
    expect(result.symbols[1]?.signature).not.toContain("return")
    expect(result.tests.map((test) => test.name)).toEqual(["service", "runs"])
    expect(result.tests.every((test) => test.framework === "vitest")).toBe(true)
    expect(result.tests.every((test) => test.testedSymbols.includes("createService"))).toBe(true)
  })

  it("reports invalid syntax with locations", () => {
    const result = typeScriptLanguageParser.parse({ path: "src/broken.ts", content: "export const =" })
    expect(result.diagnostics[0]).toMatchObject({ code: "TS_SYNTAX", severity: "error" })
    expect(result.diagnostics[0]?.location?.path).toBe("src/broken.ts")
  })

  it("parses TSX default exports and records re-export origins", () => {
    const component = typeScriptLanguageParser.parse({
      path: "app/page.tsx",
      content: "export default function Page() { return <main>Home</main> }",
    })
    const barrel = typeScriptLanguageParser.parse({
      path: "src/index.ts",
      content: 'export { helper as renamed } from "./helper"\nconst lazy = import("./lazy")\nconst legacy = require("./legacy")',
    })
    const anonymous = typeScriptLanguageParser.parse({ path: "src/default.ts", content: "export default () => 1" })

    expect(component.symbols).toMatchObject([{ name: "Page", kind: "function", exported: true }])
    expect(component.exports).toMatchObject([{ name: "default", localName: "Page" }])
    expect(barrel.exports).toMatchObject([{ name: "renamed", localName: "helper", source: "./helper" }])
    expect(barrel.imports.map((item) => item.specifier)).toEqual(["./helper", "./lazy", "./legacy"])
    expect(anonymous.symbols).toMatchObject([{ name: "default", kind: "function", exported: true }])
  })
})
