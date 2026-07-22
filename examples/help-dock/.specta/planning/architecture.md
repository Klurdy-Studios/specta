# Architecture

Help Dock is a small server-mediated complaint management system in which customer care staff use a focused workspace to capture complaints, retrieve relevant records, track status, and record resolutions. All information requests and changes pass through a centralized server-action boundary that exposes only the data needed by each interaction. Complaint workflow rules govern valid records and state changes independently of persistence, while a JSON repository remains the authoritative store and protects consistency during reads and updates. This separation keeps the application straightforward and maintainable while supporting clear complaint handling, centralized data access, privacy, and reliable file-backed storage.

## Components

- Customer Care Workspace — presents complaint capture, retrieval, status tracking, and resolution interactions to customer care staff using only the information needed for each task.
- Server Action Boundary — receives staff requests, coordinates complaint operations, and centralizes the information exposed or changed by each interaction.
- Complaint Workflow — defines complaint records, validates required information and allowed state changes, and provides clear status and resolution behavior.
- JSON Complaint Repository — serves as the authoritative complaint record and performs consistent file-backed retrieval and persistence without leaking storage concerns into other boundaries.
