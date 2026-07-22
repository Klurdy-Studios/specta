/** Stable identifier shared by every event source. */
export type EventId = string

/** Portable ISO-8601 schedule values for an event. */
export interface EventSchedule {
  startsAt: string;
  endsAt?: string
}

/** Canonical visitor-facing event record. */
export interface Event {
  id: EventId;
  title: string;
  category: string;
  location: string;
  schedule: EventSchedule;
  description: string;
  attendanceInfo: string
}

/** Optional discovery criteria. Both criteria must match when supplied. */
export interface EventQuery {
  category?: string;
  location?: string
}

/** Reasons that a source record was rejected during normalization. */
export interface EventValidationIssue {
  recordIndex: number;
  reasons: readonly string[]
}

/** A source load, retaining valid events and rejected-record diagnostics. */
export interface EventSourceSnapshot {
  events: readonly Event[];
  issues: readonly EventValidationIssue[]
}
