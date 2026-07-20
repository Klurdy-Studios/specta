# Roadmap

## 1. Portable Event Catalog

**Objective:** Establish a dependable, public read-only event catalog whose behavior is independent of the active content source, reducing migration risk before visitor experiences depend on it.

### Outcomes

- Event records from the initial JSON source are presented through a consistent, storage-neutral event model.
- Consumers can list events, filter them by category and location, and retrieve one event without knowing how content is stored.
- The active content-source adapter can be replaced by a future Firestore adapter without changing catalog consumers.

## 2. Mobile Event Discovery

**Objective:** Enable visitors to quickly find relevant local events through a clear, accessible browsing experience designed first for mobile devices.

### Outcomes

- Visitors can browse a legible collection of local events on common small-screen devices.
- Visitors can narrow the visible events by category and location and understand which filters are active.
- The discovery experience communicates loading, empty, and unavailable states clearly and remains usable across supported screen sizes.

## 3. Decision-Ready Event Details

**Objective:** Complete the public discovery journey by giving visitors accurate, readable information sufficient to decide whether and how to attend an event.

### Outcomes

- Visitors can open an event from discovery results and view its complete attendance-relevant details.
- Visitors can move between discovery and event details without losing the context of their search.
- Missing or unavailable events produce a clear, recoverable experience rather than a broken journey.
- All delivered visitor journeys remain public and read-only, with authentication and event management excluded.

