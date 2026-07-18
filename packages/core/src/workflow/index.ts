import { join } from "node:path"
import {
  workflowManifestSchema,
  type PlanningArtifactSet,
  type WorkflowDefinition,
  type WorkflowManifest,
  type Workspace,
} from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { nodeFileSystem } from "@specta/core/filesystem"

/** A domain package's concrete workflows and maintained native-agent assets. */
export interface WorkflowModule {
  definitions: WorkflowDefinition[]
  promptDirectory?: string
  skillDirectory?: string
}

export interface WorkflowManifestRepository {
  load(workspace: Workspace): Promise<WorkflowManifest>
  ensure(workspace: Workspace): Promise<void>
  loadPrompt(workspace: Workspace, definition: WorkflowDefinition): Promise<string>
  loadSkillTemplate(definition: WorkflowDefinition): Promise<string | null>
  loadArtifactTemplates(
    workspace: Workspace,
    definition: WorkflowDefinition,
  ): Promise<Partial<Record<PlanningArtifactSet["documents"][number]["kind"], string>>>
}

/** Loads and installs Workflow Definitions supplied by registered domain modules. */
export function createWorkflowManifestRepository(
  modules: WorkflowModule[],
  fileSystem: FileSystem = nodeFileSystem,
): WorkflowManifestRepository {
  const defaults = workflowManifest(modules)
  return {
    async load(workspace) {
      const manifestPath = join(workspace.rootPath, workspace.workflow.manifestPath)
      if (!(await fileSystem.exists(manifestPath))) {
        throw new Error("Workflow Manifest is missing. Run specta init to restore workspace workflows.")
      }
      try {
        return workflowManifestSchema.parse(JSON.parse(await fileSystem.readText(manifestPath)))
      } catch (error) {
        throw new Error("Workflow Manifest is invalid.", { cause: error })
      }
    },
    async ensure(workspace) {
      const manifestPath = join(workspace.rootPath, workspace.workflow.manifestPath)
      const exists = await fileSystem.exists(manifestPath)
      const existing = exists ? await this.load(workspace) : undefined
      const manifest = existing === undefined ? defaults : mergeWorkflows(existing, defaults)
      if (!exists || JSON.stringify(existing) !== JSON.stringify(manifest)) {
        await fileSystem.writeText(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
      }
      await Promise.all(manifest.workflows.map(async (definition) => {
        const promptPath = join(workspace.rootPath, definition.promptTemplate)
        const maintainedPrompt = await loadBundledAsset(modules, definition, "promptDirectory", fileSystem)
        const bundledPrompt = maintainedPrompt ?? defaultPromptTemplate(definition)
        if (!(await fileSystem.exists(promptPath))) {
          await fileSystem.writeText(promptPath, bundledPrompt)
        } else {
          const existingPrompt = await fileSystem.readText(promptPath)
          const managed = maintainedPrompt !== null || existingPrompt === defaultPromptTemplate(definition)
          if (managed && existingPrompt !== bundledPrompt) {
            await fileSystem.writeText(promptPath, bundledPrompt)
          }
        }
        await Promise.all(definition.artifactTemplates.map(async (templatePath) => {
          const absolutePath = join(workspace.rootPath, templatePath)
          if (!(await fileSystem.exists(absolutePath))) {
            await fileSystem.writeText(absolutePath, "{{content}}\n")
          }
        }))
      }))
    },
    async loadPrompt(workspace, definition) {
      const promptPath = join(workspace.rootPath, definition.promptTemplate)
      if (!(await fileSystem.exists(promptPath))) {
        throw new Error("Prompt Template is missing for workflow " + definition.name + ".")
      }
      return fileSystem.readText(promptPath)
    },
    loadSkillTemplate(definition) {
      return loadBundledAsset(modules, definition, "skillDirectory", fileSystem, "specta-")
    },
    async loadArtifactTemplates(workspace, definition) {
      const entries = await Promise.all(definition.artifactTemplates.map(async (path) => {
        const kind = artifactKindForTemplate(path)
        if (kind === undefined) throw new Error("Unsupported planning artifact template: " + path + ".")
        return [kind, await fileSystem.readText(join(workspace.rootPath, path))] as const
      }))
      return Object.fromEntries(entries)
    },
  }
}

export function workflowManifest(modules: WorkflowModule[]): WorkflowManifest {
  return workflowManifestSchema.parse({
    version: 1,
    workflows: modules.flatMap((module) => module.definitions),
  })
}

function mergeWorkflows(current: WorkflowManifest, defaults: WorkflowManifest): WorkflowManifest {
  const managedNames = new Set(defaults.workflows.map((workflow) => workflow.name))
  const custom = current.workflows.filter((workflow) => !managedNames.has(workflow.name))
  return { version: defaults.version, workflows: [...defaults.workflows, ...custom] }
}

async function loadBundledAsset(
  modules: WorkflowModule[],
  definition: WorkflowDefinition,
  directoryKey: "promptDirectory" | "skillDirectory",
  fileSystem: FileSystem,
  prefix = "",
): Promise<string | null> {
  const module = modules.find((candidate) => candidate.definitions.some((item) => item.name === definition.name))
  const directory = module?.[directoryKey]
  if (directory === undefined) return null
  const path = join(directory, prefix + definition.name + ".md")
  return await fileSystem.exists(path) ? fileSystem.readText(path) : null
}

function defaultPromptTemplate(definition: WorkflowDefinition): string {
  return [
    "# Specta " + definition.name + " workflow",
    "",
    definition.description,
    "",
    "Follow the Workspace Graph as the source of truth.",
    "Use only the context supplied for this workflow.",
    "Report the workflow outcome and validation results.",
    "",
  ].join("\n")
}

function artifactKindForTemplate(path: string): PlanningArtifactSet["documents"][number]["kind"] | undefined {
  const match = /^\.specta\/workflows\/artifacts\/(vision|constitution|architecture|roadmap|epic)\.md$/.exec(path)
  return match?.[1] as PlanningArtifactSet["documents"][number]["kind"] | undefined
}
