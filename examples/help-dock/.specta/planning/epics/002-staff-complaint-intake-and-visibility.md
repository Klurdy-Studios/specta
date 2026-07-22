# Epic — Staff Complaint Intake and Visibility

Epic ID: `plan_dd79ddcf04f64233`

## Goal

Give customer care staff a focused workspace for recording complaints, seeing what has been reported, and retrieving the details needed for follow-up.

## Story — Capture a Customer Complaint

As customer care staff, I want to record a customer concern through a simple intake experience so that it enters the accountable complaint workflow.

### Acceptance Criteria

- Staff can submit all information required to create a complaint.
- A successful submission confirms that the complaint was recorded and makes the new record available for retrieval.
- An invalid submission identifies the information that needs correction and does not create a partial complaint.
- The intake interaction does not display unrelated complaint or customer information.

### Tasks

- [ ] Create the Complaint Intake Experience — Provide a focused staff interaction for entering the information required by a complaint record.
- [ ] Connect Intake to Complaint Creation — Submit intake information through the approved server operation and handle success and validation results.
- [ ] Verify Intake Outcomes — Confirm successful creation, correction of invalid input, prevention of partial records, and limited information exposure.

## Story — Review the Complaint Register

As customer care staff, I want to see existing complaints and their current statuses so that I can identify records that need follow-up.

### Acceptance Criteria

- Staff can retrieve a complaint register without opening or reading the JSON store directly.
- Each register entry presents enough identifying information and the current status to support selection and follow-up.
- The register omits complaint details and customer information that are not needed to identify and assess entries.
- An empty complaint store produces a clear empty state rather than an error or misleading entry.

### Tasks

- [ ] Define the Complaint Summary — Determine the minimum identifying and status information needed for staff to review the complaint register.
- [ ] Build the Complaint Register Experience — Present complaint summaries retrieved through the approved server operation, including a clear empty state.
- [ ] Verify Register Privacy and States — Confirm populated, empty, and failed retrieval states while ensuring summaries exclude unnecessary complaint information.

## Story — Inspect a Complaint

As customer care staff, I want to retrieve one complaint's relevant details so that I can understand the concern and decide the next action.

### Acceptance Criteria

- Selecting an existing complaint returns its relevant concern, status, and resolution information when available.
- Requesting a complaint that does not exist produces a clear not-found result without exposing other records.
- The detail interaction omits customer information that is not needed to understand or progress the complaint.

### Tasks

- [ ] Define the Complaint Detail View — Determine the complaint information staff require for follow-up while excluding unrelated customer data.
- [ ] Build Complaint Detail Retrieval — Retrieve and present a selected complaint through the approved server operation with clear missing-record behavior.
- [ ] Verify Detail Access Outcomes — Confirm existing, missing, and failed retrieval behavior and validate that only permitted detail information is shown.
