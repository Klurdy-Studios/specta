import { join } from "node:path"
import type { SkillTarget, WorkflowDefinition, Workspace } from "@specta/core"
import type { FileSystem } from "@specta/filesystem"
import { nodeFileSystem } from "@specta/filesystem"
import { createWorkflowManifestRepository, type WorkflowManifestRepository } from "@specta/workflow"

export interface SkillGenerator {
  generate(workspace: Workspace, targets: SkillTarget[]): Promise<string[]>
}

export function isValidSkillTarget(target: SkillTarget): boolean {
  return /^[a-z][a-z0-9-]*$/.test(target)
}

export function createSkillGenerator(
  manifestRepository: WorkflowManifestRepository = createWorkflowManifestRepository(),
  fileSystem: FileSystem = nodeFileSystem,
): SkillGenerator {
  return {
    async generate(workspace, targets) {
      const manifest = await manifestRepository.load(workspace)
      if (targets.some((target) => !isValidSkillTarget(target))) {
        throw new Error("Skill targets must contain lowercase letters, numbers and hyphens only.")
      }
      const artifacts = targets.flatMap((target) => manifest.workflows.map((workflow) => ({
        path: skillPath(target, workflow),
        content: renderSkill(target, workflow),
      })))
      await Promise.all(artifacts.map(async ({ path, content }) => {
        const absolutePath = join(workspace.rootPath, path)
        if (!(await fileSystem.exists(absolutePath)) || await fileSystem.readText(absolutePath) !== content) {
          await fileSystem.writeText(absolutePath, content)
        }
      }))
      return artifacts.map((artifact) => artifact.path)
    },
  }
}

function skillPath(target: SkillTarget, workflow: WorkflowDefinition): string {
  if (target === "codex") return ".specta/skills/codex/" + workflow.name + "/SKILL.md"
  if (target === "claude-code") return ".specta/skills/claude-code/commands/" + workflow.name + ".md"
  if (target === "cursor") return ".specta/skills/cursor/commands/" + workflow.name + ".md"
  if (target === "vscode") return ".specta/skills/vscode/commands/" + workflow.name + ".json"
  return ".specta/skills/" + target + "/" + workflow.name + ".skill.md"
}

function renderSkill(target: SkillTarget, workflow: WorkflowDefinition): string {
  if (target === "vscode") {
    return JSON.stringify({
      command: "specta." + workflow.name,
      title: "Specta: " + workflow.name,
      workflow: workflow.name,
      promptTemplate: workflow.promptTemplate,
    }, null, 2) + "\n"
  }
  return [
    "# " + workflow.name + " — Specta Skill",
    "",
    "Target: " + target,
    "Workflow: " + workflow.name,
    "Description: " + workflow.description,
    "Prompt template: " + workflow.promptTemplate,
    "Validation: " + (workflow.validationRequirements.length === 0 ? "none" : workflow.validationRequirements.join("; ")),
    "",
    "This Skill is the native command surface. Read the referenced prompt template, then invoke the Specta Workflow Engine.",
    "CLI helper: " + cliInvocation(workflow.name),
    "",
  ].join("\n")
}

function cliInvocation(workflowName: string): string {
  if (workflowName === "plan") return "specta plan"
  if (workflowName === "plan-foundation") return "specta plan foundation <brief>"
  if (workflowName === "plan-architecture") return "specta plan architecture"
  if (workflowName === "plan-roadmap") return "specta plan roadmap"
  if (workflowName === "plan-epics") return "specta plan epics"
  return "specta " + workflowName
}
