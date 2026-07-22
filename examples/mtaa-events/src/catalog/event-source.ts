import type { EventSourceSnapshot } from "../domain/event"

/** Replaceable, read-only boundary for loading normalized event content. */
export interface EventSource {
  load(): Promise<EventSourceSnapshot>
}
