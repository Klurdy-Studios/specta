import { describe, expect, it } from "vitest"
import {
  foundationDraftSchema,
  epicsDraftSchema,
  roadmapDraftSchema,
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

  it("rejects duplicate Roadmap milestone titles and outcomes", () => {
    expect(() => roadmapDraftSchema.parse({
      milestones: [
        { title: "MVP", objective: "Deliver the MVP.", outcomes: ["Users can plan work.", "users can plan work."] },
      ],
    })).toThrow("Roadmap milestone outcomes must be unique")
    expect(() => roadmapDraftSchema.parse({
      milestones: [
        { title: "MVP", objective: "Deliver the MVP.", outcomes: ["Users can plan work."] },
        { title: "mvp", objective: "Repeat the MVP.", outcomes: ["The MVP is repeated."] },
      ],
    })).toThrow("Roadmap milestone titles must be unique")
    expect(() => roadmapDraftSchema.parse({
      milestones: [{ title: "MVP", objective: "", outcomes: ["Delivered."] }],
    })).toThrow()
    expect(() => roadmapDraftSchema.parse({
      milestones: [{ title: "MVP", objective: "Deliver it.", outcomes: [] }],
    })).toThrow()
    expect(() => roadmapDraftSchema.parse({
      milestones: [{ title: "MVP", objective: "Deliver it.", outcomes: ["Delivered."], status: "planned" }],
    })).toThrow()
  })

  it("rejects duplicate or incomplete Epics content", () => {
    const story = {
      title: "Create work",
      description: "A user can create work.",
      acceptanceCriteria: ["Work is persisted."],
      tasks: [{ title: "Define creation", description: "Define the creation behavior." }],
    }
    expect(() => epicsDraftSchema.parse({
      epics: [
        { title: "Planning", goal: "Plan work.", roadmapMilestone: "MVP", stories: [story] },
        { title: "planning", goal: "Repeat work.", roadmapMilestone: "MVP", stories: [story] },
      ],
    })).toThrow("Epic titles must be unique")
    expect(() => epicsDraftSchema.parse({
      epics: [{
        title: "Planning",
        goal: "Plan work.",
        roadmapMilestone: "MVP",
        stories: [{ ...story, acceptanceCriteria: ["Done.", "done."] }],
      }],
    })).toThrow("Story acceptance criteria must be unique")
    expect(() => epicsDraftSchema.parse({
      epics: [{
        title: "Planning",
        goal: "Plan work.",
        roadmapMilestone: "MVP",
        stories: [story, { ...story, title: "create work" }],
      }],
    })).toThrow("Epic story titles must be unique")
    expect(() => epicsDraftSchema.parse({
      epics: [{
        title: "Planning",
        goal: "Plan work.",
        roadmapMilestone: "MVP",
        stories: [{ ...story, tasks: [story.tasks[0]!, { ...story.tasks[0]!, title: "define creation" }] }],
      }],
    })).toThrow("Story task titles must be unique")
    expect(() => epicsDraftSchema.parse({
      epics: [{ title: "Planning", goal: "Plan work.", roadmapMilestone: "MVP", stories: [] }],
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
