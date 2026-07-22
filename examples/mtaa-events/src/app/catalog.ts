import { createEventCatalog } from "../catalog/event-catalog"
import type { EventCatalog } from "../catalog/event-catalog"
import { createJsonEventSource } from "../data/json-event-source"
import records from "../data/events.json"

/** Configured public catalog; consumers do not depend on the active source. */
export const eventCatalog: EventCatalog = createEventCatalog(createJsonEventSource(records))
