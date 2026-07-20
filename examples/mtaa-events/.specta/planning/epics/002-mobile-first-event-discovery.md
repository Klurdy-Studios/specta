# Epic — Mobile-First Event Discovery

## Goal

Give visitors an accessible, responsive way to browse local events and narrow the collection by category and location with clear feedback.

## Story — Browse Local Events on Small Screens

As a visitor using a mobile device, I want to scan available local events easily so that I can identify activities that interest me.

### Acceptance Criteria

- Available events are presented as a legible collection with enough summary information to distinguish one event from another.
- The event collection is usable without horizontal scrolling at common small-screen widths.
- The browsing experience remains clear and usable when the viewport expands to larger screen sizes.
- Each event summary provides an understandable way to open that event's details.

### Tasks

- [ ] Shape Event Discovery Summaries — Select and organize the catalog information visitors need to scan and compare event results.
- [ ] Deliver the Responsive Event Collection — Create the small-screen-first browsing experience and its adaptations for larger viewports.
- [ ] Connect Summaries to Event Details — Provide a clear, accessible interaction from every event summary to its detail destination.

## Story — Filter by Category and Location

As a visitor, I want to narrow events by category and location so that I can focus on activities relevant to my interests and area.

### Acceptance Criteria

- A visitor can select an available category and see only events in that category.
- A visitor can select an available location and see only events in that location.
- When category and location are both selected, the results satisfy both selections.
- The currently active filters are visible and can be cleared without reloading the experience.
- Filter controls can be understood and operated with keyboard and touch input.

### Tasks

- [ ] Derive Available Filter Choices — Supply category and location options from the event catalog in a consistent, visitor-readable form.
- [ ] Deliver Accessible Filter Controls — Provide category and location controls with visible selection, clear, and combined-filter behavior.
- [ ] Synchronize Filters and Results — Apply active filter criteria to the displayed event collection and keep result feedback current.

## Story — Understand Discovery States

As a visitor, I want clear feedback while events load or cannot be shown so that I understand what is happening and what I can do next.

### Acceptance Criteria

- The discovery experience visibly distinguishes loading, loaded, empty-filter-result, empty-catalog, and unavailable states.
- An empty filtered result explains that no events match the active criteria and offers a way to change or clear them.
- An unavailable catalog state communicates the problem without displaying stale or misleading results and offers a recovery action when one is possible.
- Status feedback is available to assistive technology and does not rely on color alone.

### Tasks

- [ ] Define Discovery State Messages — Specify clear visitor-facing feedback and recovery choices for each discovery state.
- [ ] Deliver Discovery State Presentation — Present loading, empty, unavailable, and successful results accessibly across supported screen sizes.

