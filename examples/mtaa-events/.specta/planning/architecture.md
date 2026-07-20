# Architecture

Mtaa Events is a public, read-only directory organized around a mobile-first visitor experience, an application boundary for browsing and event detail use cases, and a storage-independent event catalog boundary. The visitor experience requests event lists, category and location filtering, and individual event details through stable application capabilities rather than reading content directly. The catalog boundary supplies a consistent event representation while source-specific adapters handle the initial JSON content and allow a later Firestore implementation to replace it without changing visitor-facing behavior. This separation keeps the initial system small while preserving accessibility, resilience, content clarity, and future content portability required by the Constitution.

## Components

- Visitor Experience — presents accessible, mobile-first event browsing, filter controls, result states, and event details across screen sizes and common connection conditions.
- Event Discovery Application — coordinates public read-only use cases for listing events, applying category and location filters, and retrieving a selected event's details.
- Event Catalog Boundary — defines the storage-neutral event model and query contract consumed by discovery capabilities, keeping content behavior consistent across data sources.
- Content Source Adapter — loads and maps event records from the active content source into the catalog contract, using JSON initially and permitting a later Firestore adapter.

