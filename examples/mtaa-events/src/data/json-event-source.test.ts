import { describe, expect, it } from "vitest"
import { createJsonEventSource } from "./json-event-source"

const validRecord = {
  id: "  stable-id  ",
  title: "  Neighborhood Gathering  ",
  category: "Community",
  location: "Kawangware",
  schedule: {
    startsAt: "2026-09-01T10:00:00+03:00",
    endsAt: "2026-09-01T12:00:00+03:00",
  },
  description: "Meet neighbors and local organizers.",
  attendanceInfo: "Free and open to all.",
}

describe("JSON event source", () => {
  it("normalizes valid JSON into the canonical event representation", async () => {
    const snapshot = await createJsonEventSource([validRecord]).load()

    expect(snapshot.issues).toEqual([])
    expect(snapshot.events).toEqual([{
      ...validRecord,
      id: "stable-id",
      title: "Neighborhood Gathering",
    }])
  })

  it("reports incomplete and malformed records without presenting them", async () => {
    const snapshot = await createJsonEventSource([
      validRecord,
      { id: "incomplete", title: "Missing visitor details" },
      "not an object",
      { ...validRecord, id: "bad-date", schedule: { startsAt: "someday" } },
    ]).load()

    expect(snapshot.events).toHaveLength(1)
    expect(snapshot.issues).toHaveLength(3)
    expect(snapshot.issues[0]).toEqual(expect.objectContaining({
      recordIndex: 1,
      reasons: expect.arrayContaining([
        "category must be a non-empty string",
        "schedule must be an object",
      ]),
    }))
    expect(snapshot.issues[1]).toEqual({ recordIndex: 2, reasons: ["record must be an object"] })
    expect(snapshot.issues[2].reasons).toContain("schedule.startsAt must be a valid date-time")
  })

  it("rejects duplicate identifiers and schedules that end before they start", async () => {
    const snapshot = await createJsonEventSource([
      validRecord,
      { ...validRecord, title: "Duplicate" },
      {
        ...validRecord,
        id: "backwards",
        schedule: {
          startsAt: "2026-09-02T12:00:00+03:00",
          endsAt: "2026-09-02T10:00:00+03:00",
        },
      },
    ]).load()

    expect(snapshot.events).toHaveLength(1)
    expect(snapshot.issues[0].reasons[0]).toContain("id must be unique")
    expect(snapshot.issues[1].reasons).toContain(
      "schedule.endsAt must not be before schedule.startsAt",
    )
  })

  it("returns a fresh snapshot so callers cannot mutate later loads", async () => {
    const source = createJsonEventSource([validRecord])
    const first = await source.load()
    ;(first.events as unknown[]).length = 0

    expect((await source.load()).events).toHaveLength(1)
  })
})
