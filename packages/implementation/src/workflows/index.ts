import { fileURLToPath } from "node:url"
import type { WorkflowDefinition } from "@specta/core"
import type { WorkflowModule } from "@specta/core/workflow"

export const implementationWorkflowModule: WorkflowModule = {
  definitions: [
    workflow(
      "design",
      "Create a reviewable Technical Design for one Epic and target project.",
      ["architecture", "epics"],
      ["technical-design"],
      ["resolve-epic", "resolve-project-profile", "validate-language", "persist-technical-design"],
      "target-id",
      "The Epic to design.",
    ),
    workflow(
      "approve-design",
      "Approve the latest reviewed Technical Design after resolving cross-Epic dependencies.",
      ["technical-design"],
      ["approved-technical-design"],
      ["resolve-technical-design", "validate-language", "validate-dependencies", "approve-technical-design"],
      "design-id",
      "The Technical Design to approve.",
    ),
    workflow(
      "scaffold",
      "Prepare and finalize declaration-only scaffolding through the selected coding agent.",
      ["approved-technical-design"],
      ["scaffolded-structure"],
      ["prepare-scaffold", "agent-apply-scaffold", "finalize-scaffold", "update-workspace-graph"],
      "design-id",
      "The approved Technical Design to scaffold.",
    ),
    workflow(
      "validate",
      "Validate one Epic implementation against graph-backed intent and executable project checks.",
      ["approved-technical-design", "source-analysis"],
      ["validation-report"],
      ["resolve-epic", "compile-context", "validate-structure", "run-project-checks", "persist-validation-report"],
      "epic-id",
      "The implemented Epic to validate.",
    ),
    workflow(
      "implement",
      "Implement one eligible Epic through the active coding agent and finalize it with authoritative validation.",
      ["scaffolded-structure", "source-analysis"],
      ["implementation-run", "validation-report", "implementation-relationships"],
      ["resolve-eligible-epic", "prepare-implementation", "agent-implement", "finalize-implementation"],
      "epic-id",
      "The Epic to implement, or next for deterministic selection.",
    ),
  ],
  promptDirectory: fileURLToPath(new URL("../../templates/prompts", import.meta.url)),
  skillDirectory: fileURLToPath(new URL("../../templates/skills", import.meta.url)),
}

function workflow(
  name: string,
  description: string,
  requires: string[],
  produces: string[],
  executionSteps: string[],
  parameterName: string,
  parameterDescription: string,
): WorkflowDefinition {
  return {
    name,
    description,
    parameters: [{ name: parameterName, description: parameterDescription, required: true }],
    requires,
    produces,
    executionSteps,
    promptTemplate: ".specta/workflows/prompts/" + name + ".md",
    artifactTemplates: [],
    completionCriteria: produces.map((artifact) => artifact + " is generated and linked to the Workspace Graph."),
    validationRequirements: ["workflow-state"],
  }
}
