import { describe, expect, expectTypeOf, it } from "vitest"
import type { Event, EventSourceSnapshot } from "./event"

describe("event domain contract", () => {
  it("represents every visitor-facing field with storage-neutral values", () => {
    const event: Event = {
      id: "event-1",
      title: "Community Film Night",
      category: "Film",
      location: "Mathare",
      schedule: { startsAt: "2026-08-20T18:00:00+03:00" },
      description: "An outdoor screening.",
      attendanceInfo: "Free entry.",
    }

    expect(event).toEqual(expect.objectContaining({
      id: expect.any(String),
      title: expect.any(String),
      category: expect.any(String),
      location: expect.any(String),
      schedule: expect.objectContaining({ startsAt: expect.any(String) }),
      description: expect.any(String),
      attendanceInfo: expect.any(String),
    }))
    expectTypeOf<EventSourceSnapshot["events"]>().toEqualTypeOf<readonly Event[]>()
  })
})
