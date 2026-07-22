import type {
  Event,
  EventId,
  EventQuery,
  EventValidationIssue,
} from "../domain/event"
import type { EventSource } from "./event-source"

/** Results from a catalog query, including any source diagnostics. */
export interface EventCatalogResult {
  events: readonly Event[];
  issues: readonly EventValidationIssue[]
}

/** Complete public, read-only catalog API. */
export interface EventCatalog {
  list(query?: EventQuery): Promise<EventCatalogResult>;
  findById(id: EventId): Promise<Event | null>
}

/** Creates storage-neutral catalog operations around a conforming source. */
export function createEventCatalog(source: EventSource): EventCatalog {
  return {
    async list(query = {}) {
      const snapshot = await source.load()
      const category = normalizeCriterion(query.category)
      const location = normalizeCriterion(query.location)

      return {
        events: snapshot.events.filter((event) =>
          (!category || event.category.toLocaleLowerCase() === category) &&
          (!location || event.location.toLocaleLowerCase() === location)),
        issues: snapshot.issues,
      }
    },

    async findById(id) {
      const snapshot = await source.load()
      return snapshot.events.find((event) => event.id === id) ?? null
    },
  }
}

function normalizeCriterion(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLocaleLowerCase()
  return normalized || undefined
}
