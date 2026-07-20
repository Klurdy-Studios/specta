import { join } from "node:path"
import { skillTargetSchema, type SkillTarget, type WorkflowDefinition, type Workspace } from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { nodeFileSystem } from "@specta/core/filesystem"
import type { WorkflowManifestRepository } from "@specta/core/workflow"

export interface SkillGenerator {
  generate(workspace: Workspace, targets: SkillTarget[]): Promise<string[]>
}

export interface FrameworkSkillDiscoveryResult {
  query: string
  installed: Array<{ name: string, path: string }>
  onlineSearch?: { executable: "npx", arguments: string[] }
}

export interface FrameworkSkillDiscovery {
  discover(workspace: Workspace, query: string): Promise<FrameworkSkillDiscoveryResult>
}

export function isValidSkillTarget(target: SkillTarget): boolean {
  return skillTargetSchema.safeParse(target).success
}

export function createSkillGenerator(
  manifestRepository: WorkflowManifestRepository,
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
        content: await renderSkill(workflow, manifestRepository),
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

/** Finds relevant installed Skills and returns an explicit, non-executed online search command. */
export function createFrameworkSkillDiscovery(
  fileSystem: FileSystem = nodeFileSystem,
): FrameworkSkillDiscovery {
  return {
    async discover(workspace, query) {
      const normalized = query.toLowerCase()
      const matches: FrameworkSkillDiscoveryResult["installed"] = []
      for (const root of skillSearchRoots(workspace)) {
        const absoluteRoot = join(workspace.rootPath, root)
        if (!(await fileSystem.exists(absoluteRoot))) continue
        for (const name of await fileSystem.listDirectories(absoluteRoot)) {
          if (name.startsWith("specta-")) continue
          const path = root + "/" + name + "/SKILL.md"
          const absolutePath = join(workspace.rootPath, path)
          if (!(await fileSystem.exists(absolutePath))) continue
          const content = await fileSystem.readText(absolutePath)
          if ((name + "\n" + content).toLowerCase().includes(normalized)) matches.push({ name, path })
        }
      }
      const installed = [...new Map(matches.map((match) => [match.path, match])).values()]
      return {
        query,
        installed,
        ...(query === "none" ? {} : {
          onlineSearch: { executable: "npx" as const, arguments: ["skills", "find", query + " project scaffolding"] },
        }),
      }
    },
  }
}

function skillSearchRoots(workspace: Workspace): string[] {
  const nativeRoots: Partial<Record<SkillTarget, string>> = {
    codex: ".codex/skills",
    "claude-code": ".claude/skills",
    cursor: ".cursor/skills",
    vscode: ".github/skills",
  }
  return [...new Set(workspace.workflow.skillTargets.flatMap((target) => [
    ".specta/skills/" + target,
    ...(nativeRoots[target] === undefined ? [] : [nativeRoots[target]]),
  ]))]
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
  manifestRepository: WorkflowManifestRepository,
): Promise<string> {
  const name = skillName(workflow)
  const template = await manifestRepository.loadSkillTemplate(workflow)
  if (template !== null) return template
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
  if (workflowName === "plan-architecture") return "plan architecture [guidance] --draft <architecture-draft.json>"
  if (workflowName === "plan-roadmap") return "plan roadmap --draft <roadmap-draft.json>"
  if (workflowName === "plan-epics") return "plan epics --draft .specta/drafts/plan-epics.json"
  if (workflowName === "design") return "design <epic-id> --draft <draft.json> [--feedback <changes>]"
  if (workflowName === "approve-design") return "approve-design <design-id>"
  if (workflowName === "scaffold") return "scaffold <design-id> --prepare; then scaffold <design-id> --finalize <scaffold-run-id>"
  return workflowName
}
