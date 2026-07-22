import { describe, expect, it } from "vitest"
import type { Event } from "../domain/event"
import type { EventSource } from "./event-source"
import { createEventCatalog } from "./event-catalog"

const events: readonly Event[] = [
  {
    id: "music-ngara",
    title: "Music in Ngara",
    category: "Music",
    location: "Ngara",
    schedule: { startsAt: "2026-08-01T12:00:00Z" },
    description: "Live music.",
    attendanceInfo: "Free.",
  },
  {
    id: "art-ngara",
    title: "Art in Ngara",
    category: "Art",
    location: "Ngara",
    schedule: { startsAt: "2026-08-02T12:00:00Z" },
    description: "Local art.",
    attendanceInfo: "Tickets at the door.",
  },
  {
    id: "music-kibera",
    title: "Music in Kibera",
    category: "Music",
    location: "Kibera",
    schedule: { startsAt: "2026-08-03T12:00:00Z" },
    description: "Live music.",
    attendanceInfo: "Free.",
  },
]

function sourceWith(content: readonly Event[]): EventSource {
  return { async load() { return { events: content, issues: [] } } }
}

describe("event catalog", () => {
  it("lists available events through the source boundary", async () => {
    await expect(createEventCatalog(sourceWith(events)).list()).resolves.toEqual({
      events,
      issues: [],
    })
  })

  it("filters by category, location, or both without case sensitivity", async () => {
    const catalog = createEventCatalog(sourceWith(events))

    expect((await catalog.list({ category: " music " })).events).toHaveLength(2)
    expect((await catalog.list({ location: "NGARA" })).events).toHaveLength(2)
    expect((await catalog.list({ category: "Music", location: "Ngara" })).events)
      .toEqual([events[0]])
    expect((await catalog.list({ category: "Sport" })).events).toEqual([])
  })

  it("finds an event by stable identifier and returns null when missing", async () => {
    const catalog = createEventCatalog(sourceWith(events))

    await expect(catalog.findById("art-ngara")).resolves.toEqual(events[1])
    await expect(catalog.findById("missing")).resolves.toBeNull()
  })

  it("keeps operation signatures and event meanings when the source is replaced", async () => {
    const alternateSource: EventSource = {
      async load() {
        return { events: [events[1]], issues: [] }
      },
    }
    const catalog = createEventCatalog(alternateSource)

    await expect(catalog.list()).resolves.toEqual({ events: [events[1]], issues: [] })
    await expect(catalog.findById("art-ngara")).resolves.toEqual(events[1])
  })
})
