# Epic — Storage-Neutral Event Catalog

Epic ID: `plan_69546d6ed82d51f9`

## Goal

Deliver a consistent public event catalog that supports discovery and details from JSON today while allowing the content source to change without affecting consumers.

## Story — Use Consistent Event Records

As a visitor-experience developer, I need event content represented consistently so that every discovery and detail view can rely on the same meaningful fields.

### Acceptance Criteria

- Every available event has a stable identifier, title, category, location, schedule, description, and attendance-relevant information.
- Event records exposed to consumers use the same field meanings regardless of the underlying content source.
- Invalid or incomplete source records are identified without silently presenting misleading event information.

### Tasks

- [ ] Define the Catalog Event Contract — Specify the storage-neutral event representation and the meaning and validity rules for each visitor-facing field.
- [ ] Normalize Source Records — Map source content into the catalog representation and handle records that do not satisfy its validity rules.

## Story — Query Events Without Storage Knowledge

As a visitor-experience developer, I need read-only catalog capabilities for discovery and details so that product behavior does not depend on storage mechanics.

### Acceptance Criteria

- A consumer can request the available event collection without accessing the active content source directly.
- A consumer can request events matching a category, a location, or both filters together.
- A consumer can request one event by its stable identifier and can distinguish a missing event from an available event.
- All catalog capabilities are read-only and expose no authentication or event-management behavior.

### Tasks

- [ ] Specify Read-Only Catalog Operations — Define the list, filter, and single-event operations and their success, empty, and missing-result behavior.
- [ ] Coordinate Discovery Queries — Deliver application behavior that applies category and location criteria and returns catalog results to consumers.

## Story — Serve JSON Through a Replaceable Source

As a maintainer, I need JSON content isolated behind the catalog boundary so that a future Firestore source can be introduced without redesigning consumer behavior.

### Acceptance Criteria

- The initial JSON content supplies all catalog operations through the storage-neutral contract.
- JSON-specific structure and loading behavior are not exposed to catalog consumers.
- A different conforming content-source adapter can be substituted without changing the catalog operation signatures or event representation.

### Tasks

- [ ] Define the Content Source Contract — Establish the source responsibilities needed to supply normalized records without leaking storage-specific details.
- [ ] Deliver the JSON Source Adapter — Load the initial event content and translate it through the content-source and catalog contracts.
- [ ] Verify Source Substitutability — Confirm catalog consumers retain identical operations and event meanings when a conforming alternate source is used.
