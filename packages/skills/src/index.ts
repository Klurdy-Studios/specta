import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { skillTargetSchema, type SkillTarget, type WorkflowDefinition, type Workspace } from "@specta/core"
import type { FileSystem } from "@specta/filesystem"
import { nodeFileSystem } from "@specta/filesystem"
import { createWorkflowManifestRepository, type WorkflowManifestRepository } from "@specta/workflow"

export interface SkillGenerator {
  generate(workspace: Workspace, targets: SkillTarget[]): Promise<string[]>
}

export function isValidSkillTarget(target: SkillTarget): boolean {
  return skillTargetSchema.safeParse(target).success
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
      const artifacts = await Promise.all(targets.flatMap((target) => manifest.workflows.map(async (workflow) => ({
        path: skillPath(target, workflow),
        content: await renderSkill(workflow, fileSystem),
      }))))
      const legacyArtifacts = targets.flatMap((target) => manifest.workflows.flatMap((workflow) => legacySkillPaths(target, workflow)))
      await Promise.all(legacyArtifacts.map((path) => fileSystem.removePath(join(workspace.rootPath, path))))
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

function skillName(workflow: WorkflowDefinition): string {
  return "specta-" + workflow.name
}

function skillPath(target: SkillTarget, workflow: WorkflowDefinition): string {
  const name = skillName(workflow)
  return ".specta/skills/" + target + "/" + name + "/SKILL.md"
}

function legacySkillPaths(target: SkillTarget, workflow: WorkflowDefinition): string[] {
  const root = ".specta/skills/" + target + "/"
  const name = skillName(workflow)
  if (target === "codex") return [root + workflow.name]
  if (target === "claude-code" || target === "cursor") {
    return [root + "commands/" + workflow.name + ".md", root + "commands/" + name + ".md"]
  }
  if (target === "vscode") {
    return [root + "commands/" + workflow.name + ".json", root + "commands/" + name + ".json"]
  }
  return [root + workflow.name + ".skill.md", root + name + ".skill.md"]
}

async function renderSkill(
  workflow: WorkflowDefinition,
  fileSystem: FileSystem,
): Promise<string> {
  const name = skillName(workflow)
  const templatePath = join(fileURLToPath(new URL("../templates", import.meta.url)), name + ".md")
  if (await fileSystem.exists(templatePath)) return fileSystem.readText(templatePath)
  return [
    "---",
    "name: " + JSON.stringify(name),
    "description: " + JSON.stringify(workflow.description),
    "---",
    "",
    "# " + name + " — Specta Skill",
    "",
    "Workflow: " + workflow.name,
    "Description: " + workflow.description,
    "Prompt template: " + workflow.promptTemplate,
    "Validation: " + (workflow.validationRequirements.length === 0 ? "none" : workflow.validationRequirements.join("; ")),
    "",
    "This Skill is the native command surface. Read the referenced prompt template, then invoke the Specta Workflow Engine.",
    "CLI helper arguments: " + cliInvocation(workflow.name),
    "Read .specta/runtime.json and append these arguments to its cliCommand.",
    "",
  ].join("\n")
}

function cliInvocation(workflowName: string): string {
  if (workflowName === "plan") return "plan --draft <planning-draft.json>"
  if (workflowName === "plan-foundation") return "plan foundation <brief> --draft <foundation-draft.json>"
  if (workflowName === "plan-architecture") return "plan architecture --draft <architecture-draft.json>"
  if (workflowName === "plan-roadmap") return "plan roadmap --draft <roadmap-draft.json>"
  if (workflowName === "plan-epics") return "plan epics --draft <epics-draft.json>"
  if (workflowName === "design") return "design <epic-id> --draft <draft.json> [--feedback <changes>]"
  if (workflowName === "approve-design") return "approve-design <design-id>"
  if (workflowName === "scaffold") return "scaffold <design-id>"
  return workflowName
}
