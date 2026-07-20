# Technical Design design_aa0465e39d8ae5e0

Status: approved
Revision: 1
Epic: plan_69546d6ed82d51f9
Target:  (react/typescript)

## Summary

Create the first Epic as a TypeScript React single-page application bootstrapped with Vite. The Epic introduces a storage-neutral event domain, read-only catalog operations, and a bundled JSON adapter. The React surface will consume only the EventCatalog contract in later Epics, so JSON can be replaced by localStorage, Firestore, or another source without changing catalog consumers. Invalid JSON records are reported separately from valid events instead of being silently displayed.

## Modules

### Event Domain

Define the canonical, storage-independent event representation, query values, and validation outcomes used by every catalog source and consumer.

- src/domain/event.ts — EventId, EventSchedule, Event, EventQuery, EventValidationIssue, EventSourceSnapshot
- src/domain/event.test.ts — no exports
### Event Catalog

Expose source-agnostic, public read-only operations for listing, filtering, and retrieving normalized events.

- src/catalog/event-source.ts — EventSource
- src/catalog/event-catalog.ts — EventCatalogResult, EventCatalog, createEventCatalog
- src/catalog/event-catalog.test.ts — no exports
### JSON Content Source

Supply the initial bundled event collection through the EventSource contract while containing JSON parsing and normalization details.

- src/data/json-event-source.ts — createJsonEventSource
- src/data/events.json — no exports
- src/data/json-event-source.test.ts — no exports
### Catalog Composition

Compose the current JSON source with the storage-neutral catalog behind one application-facing entry point for later React features.

- src/app/catalog.ts — eventCatalog

## Dependencies

None.
