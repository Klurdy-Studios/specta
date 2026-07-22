import type { EventSource } from "../catalog/event-source"
import type { Event, EventSchedule, EventValidationIssue } from "../domain/event"

/** Creates an event source that validates and normalizes untrusted JSON records. */
export function createJsonEventSource(records: readonly unknown[]): EventSource {
  return {
    async load() {
      const events: Event[] = []
      const issues: EventValidationIssue[] = []
      const acceptedIds = new Set<string>()

      records.forEach((record, recordIndex) => {
        const result = normalizeRecord(record)

        if ("reasons" in result) {
          issues.push({ recordIndex, reasons: result.reasons })
          return
        }

        if (acceptedIds.has(result.event.id)) {
          issues.push({
            recordIndex,
            reasons: [`id must be unique; ${result.event.id} was already used`],
          })
          return
        }

        acceptedIds.add(result.event.id)
        events.push(result.event)
      })

      return { events, issues }
    },
  }
}

type NormalizedRecord = { event: Event } | { reasons: readonly string[] }

function normalizeRecord(value: unknown): NormalizedRecord {
  if (!isObject(value)) {
    return { reasons: ["record must be an object"] }
  }

  const reasons: string[] = []
  const id = requiredString(value, "id", reasons)
  const title = requiredString(value, "title", reasons)
  const category = requiredString(value, "category", reasons)
  const location = requiredString(value, "location", reasons)
  const description = requiredString(value, "description", reasons)
  const attendanceInfo = requiredString(value, "attendanceInfo", reasons)
  const schedule = normalizeSchedule(value.schedule, reasons)

  if (reasons.length > 0 || !schedule) {
    return { reasons }
  }

  return {
    event: { id, title, category, location, schedule, description, attendanceInfo },
  }
}

function normalizeSchedule(value: unknown, reasons: string[]): EventSchedule | null {
  if (!isObject(value)) {
    reasons.push("schedule must be an object")
    return null
  }

  const startsAt = requiredString(value, "startsAt", reasons, "schedule.startsAt")
  const endsAt = optionalString(value, "endsAt", reasons, "schedule.endsAt")
  const startTime = Date.parse(startsAt)

  if (startsAt && Number.isNaN(startTime)) {
    reasons.push("schedule.startsAt must be a valid date-time")
  }
  if (endsAt && Number.isNaN(Date.parse(endsAt))) {
    reasons.push("schedule.endsAt must be a valid date-time")
  } else if (endsAt && !Number.isNaN(startTime) && Date.parse(endsAt) < startTime) {
    reasons.push("schedule.endsAt must not be before schedule.startsAt")
  }

  return endsAt ? { startsAt, endsAt } : { startsAt }
}

function requiredString(
  record: Record<string, unknown>,
  field: string,
  reasons: string[],
  label = field,
): string {
  const value = record[field]
  if (typeof value !== "string" || value.trim() === "") {
    reasons.push(`${label} must be a non-empty string`)
    return ""
  }
  return value.trim()
}

function optionalString(
  record: Record<string, unknown>,
  field: string,
  reasons: string[],
  label: string,
): string | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (typeof value !== "string" || value.trim() === "") {
    reasons.push(`${label} must be a non-empty string when provided`)
    return undefined
  }
  return value.trim()
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
