import type {
  Event,
  EventId,
  EventQuery,
  EventValidationIssue,
} from "../domain/event"
import type { EventSource } from "./event-source"

export interface EventCatalogResult {
  events: readonly Event[];
  issues: readonly EventValidationIssue[]
}

export interface EventCatalog {
  list(query?: EventQuery): Promise<EventCatalogResult>;
  findById(id: EventId): Promise<Event | null>
}

export declare function createEventCatalog(source: EventSource): EventCatalog
