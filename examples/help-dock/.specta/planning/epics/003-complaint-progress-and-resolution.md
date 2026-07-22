# Epic — Complaint Progress and Resolution

Epic ID: `plan_79e87e91ba4b0d7a`

## Goal

Enable staff to identify complaints needing attention, apply only valid status changes, and preserve a clear resolution outcome for completed complaints.

## Story — Identify Complaints Requiring Attention

As customer care staff, I want resolved and unresolved complaints to be clearly distinguishable so that I can focus on work that still needs action.

### Acceptance Criteria

- The complaint workspace clearly distinguishes complaints that require attention from those marked resolved.
- The displayed attention state agrees with each complaint's authoritative current status.
- When no complaints require attention, staff see a clear completed state rather than an ambiguous empty result.

### Tasks

- [ ] Define Attention Classification — Specify how approved complaint statuses determine whether staff attention is still required.
- [ ] Present Actionable Complaint States — Make unresolved and resolved records clearly distinguishable in the staff workspace.
- [ ] Verify Attention Indicators — Confirm indicators match authoritative statuses across mixed, unresolved-only, and fully resolved complaint sets.

## Story — Progress a Complaint Safely

As customer care staff, I want to update a complaint's status through allowed transitions so that its record accurately reflects the handling progress.

### Acceptance Criteria

- Staff can select an allowed next status for an existing complaint and see the updated status after retrieval.
- A disallowed status transition is rejected with a clear result and leaves the existing complaint unchanged.
- A status change for a missing complaint returns a clear not-found result without changing another record.
- Status changes are performed through the centralized server-side operation rather than direct JSON access.

### Tasks

- [ ] Define Allowed Status Transitions — Specify the simple progression rules that determine valid and invalid complaint status changes.
- [ ] Build the Status Update Interaction — Allow staff to request an available next status and receive clear success, invalid-transition, or missing-record results.
- [ ] Verify Safe Status Progression — Confirm valid persistence, invalid-transition rejection, missing-record handling, and isolation from unrelated complaints.

## Story — Record the Complaint Resolution

As customer care staff, I want to document how a complaint was resolved so that the completed outcome remains clear for later reference.

### Acceptance Criteria

- Staff can provide the required resolution information when completing an eligible complaint.
- A successfully resolved complaint is marked resolved and retains its resolution information on later retrieval.
- An attempt to resolve a complaint without required resolution information is rejected and leaves the complaint unresolved.
- An attempt to resolve an ineligible or missing complaint returns a clear result without changing stored records.

### Tasks

- [ ] Define Resolution Requirements — Specify the information and complaint state required for a clear, valid resolution outcome.
- [ ] Build the Resolution Interaction — Allow staff to record a resolution through the approved server operation and receive clear completion or correction feedback.
- [ ] Verify Durable Resolution Outcomes — Confirm valid completion, required-information checks, eligibility rules, missing-record behavior, and later retrieval of the outcome.
