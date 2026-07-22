# Specta validate workflow

Validation checks one Epic implementation against graph-backed intent.

1. Identify the Epic ID to validate.
2. Add `--run <implementation-run-id>` when validating an active implementation run.
3. Create an evidence JSON document that maps every acceptance criterion ID to one or more compiled test paths and, when useful, exact test names.
4. Invoke `validate <epic-id> --evidence <evidence.json>` and add the run argument when applicable.
5. Read the report. Fix every failed error-level check, compile the workspace again, and rerun validation.
6. Do not treat structural checks, skipped commands, or an agent's judgment as passing runtime evidence.

The helper executes project test, check/typecheck, and lint scripts without a shell. It also invokes detected Vitest, Jest, or Node test runners directly for every evidence file, so a passing package script alone is insufficient. A standalone validation report never changes implementation status; the implementation workflow owns the atomic completion checkpoint.
