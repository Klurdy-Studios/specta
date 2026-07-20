export type EventId = string

export interface EventSchedule {
  startsAt: string;
  endsAt?: string
}

export interface Event {
  id: EventId;
  title: string;
  category: string;
  location: string;
  schedule: EventSchedule;
  description: string;
  attendanceInfo: string
}

export interface EventQuery {
  category?: string;
  location?: string
}

export interface EventValidationIssue {
  recordIndex: number;
  reasons: readonly string[]
}

export interface EventSourceSnapshot {
  events: readonly Event[];
  issues: readonly EventValidationIssue[]
}
