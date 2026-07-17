import { describe, expect, it } from "vitest"
import {
  foundationDraftSchema,
  technicalDesignSchema,
  workspaceSchema,
} from "../src/index.js"

describe("canonical schemas", () => {
  it("rejects incomplete Foundation drafts", () => {
    expect(() => foundationDraftSchema.parse({
      vision: { title: "Specta", problem: "Planning is fragmented.", audience: "Developers" },
      constitution: { principles: ["Keep the graph authoritative."] },
    })).toThrow()
  })

  it("rejects invalid workspace configuration", () => {
    expect(() => workspaceSchema.parse({
      schemaVersion: 1,
      id: "ws_test",
      rootPath: "/workspace",
      createdAt: "not-a-date",
      packageManager: "pnpm",
      projects: [],
      artifacts: {},
      workflow: { skillTargets: ["codex", "codex"], manifestPath: ".specta/workflows/manifest.json" },
    })).toThrow()
  })

  it("rejects duplicate Technical Design file paths", () => {
    const file = { path: "src/session/index.ts", kind: "source", exports: [] }
    expect(() => technicalDesignSchema.parse({
      id: "design_session",
      targetId: "epic_session",
      status: "draft",
      revision: 1,
      summary: "Design the session boundary.",
      modules: [
        { name: "Session", path: "src/session", purpose: "Session boundary.", files: [file], dependencies: [] },
        { name: "Auth", path: "src/auth", purpose: "Auth boundary.", files: [file], dependencies: [] },
      ],
      dependencies: [],
      impactRequests: [],
    })).toThrow("Technical Design file paths must be unique")
  })
})
