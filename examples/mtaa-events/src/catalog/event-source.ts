import type { EventSourceSnapshot } from "../domain/event"

export interface EventSource {
  load(): Promise<EventSourceSnapshot>
}
