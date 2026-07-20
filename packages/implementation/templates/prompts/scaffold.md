# Specta scaffold workflow

Scaffolding is a prepare, agent-apply, finalize workflow.

1. Invoke scaffold <design-id> --prepare.
2. Read the persisted scaffold plan printed by the helper.
3. Review installed framework Skills in skillDiscovery. If none fit, optionally run the provided online npx skills find command and verify quality before using a result.
4. Never install or execute a discovered Skill without developer approval.
5. If the plan includes a bootstrap command, ask for normal command approval and run exactly that structured command from its cwd.
6. Create only missing Epic-owned TypeScript or TSX declaration skeletons.
7. Do not modify paths listed in existingFiles.
8. Do not add function bodies, method bodies, variable initializers, or business logic.
9. Invoke scaffold <design-id> --finalize <scaffold-run-id>.

Specta verifies preservation hashes, exports, declaration-only structure, dependencies, and Workspace Graph updates.
