#!/usr/bin/env node
import { resolve } from "node:path"
import { readFile } from "node:fs/promises"
import type { ArchitectureDraft, EpicsDraft, FoundationDraft, RoadmapDraft, ScaffoldRunId, TechnicalDesignId } from "@specta/core"
import { createWorkspaceRepository } from "@specta/core/config"
import { nodeFileSystem } from "@specta/core/filesystem"
import { createWorkspaceInitializer, type InitializeWorkspaceRequest } from "@specta/core/workspace"
import {
  createContextEngine,
  createContextPacketRepository,
  createWorkspaceAnalyzer,
  renderContextPacket,
  workspaceGraphDatabasePath,
} from "@specta/graph"
import {
  createScaffoldWorkflow,
  createTechnicalDesignApprovalWorkflow,
  createTechnicalDesignWorkflow,
  implementationWorkflowModule,
} from "@specta/implementation"
import { createPlanWorkflow, planningWorkflowModule, type PlanWorkflowInput } from "@specta/planner"

const workflowModules = [planningWorkflowModule, implementationWorkflowModule]

const [command, ...arguments_] = process.argv.slice(2)

if (command === "init") {
  try {
    const request = parseInitializeRequest(arguments_)
    const result = await createWorkspaceInitializer({ workflowModules }).initialize(request)
    const verb = result.created ? "Initialized" : "Specta workspace already exists at"
    console.log(verb + " " + result.workspace.rootPath)
    console.log("Detected " + result.workspace.projects.length + " project(s) using " + result.workspace.packageManager + ".")
    const skillTargets = result.workspace.workflow.skillTargets
    console.log("Configured native Skill targets: " + (skillTargets.length === 0 ? "none" : skillTargets.join(", ")) + ".")
  } catch (error) {
    console.error(error instanceof Error ? "specta: " + error.message : "specta: Unable to initialize workspace.")
    process.exitCode = 1
  }
} else if (command === "compile") {
  try {
    if (arguments_.length > 0) throw new Error("Usage: specta compile")
    const workspace = await createWorkspaceRepository(nodeFileSystem).load(resolve("."))
    if (workspace === null) throw new Error("Initialize a Specta workspace before compiling it.")
    const snapshot = await createWorkspaceAnalyzer().compile(workspace)
    console.log("Compiled " + snapshot.analysis.specifications.length + " specification(s) and " + snapshot.analysis.sourceFiles.length + " source file(s).")
    console.log("Workspace Graph: " + workspaceGraphDatabasePath(workspace))
    if (snapshot.analysis.diagnostics.length > 0) {
      console.log("Diagnostics: " + snapshot.analysis.diagnostics.length + ".")
    }
  } catch (error) {
    console.error(error instanceof Error ? "specta: " + error.message : "specta: Unable to compile workspace analysis.")
    process.exitCode = 1
  }
} else if (command === "context") {
  try {
    const { output, ...request } = parseContextRequest(arguments_)
    const workspace = await createWorkspaceRepository(nodeFileSystem).load(resolve("."))
    if (workspace === null) throw new Error("Initialize a Specta workspace before compiling context.")
    const persisted = request.implementationRunId
      ? await createContextPacketRepository().get(workspace, request.implementationRunId)
      : null
    if (persisted && persisted.epicId !== request.epicId) {
      throw new Error("Implementation Run context targets a different Epic.")
    }
    if (!persisted) await createWorkspaceAnalyzer().compile(workspace)
    const packet = persisted ?? await createContextEngine().compile(workspace, request)
    console.log(output === "json" ? JSON.stringify(packet, null, 2) : renderContextPacket(packet))
  } catch (error) {
    console.error(error instanceof Error ? "specta: " + error.message : "specta: Unable to compile context.")
    process.exitCode = 1
  }
} else if (command === "plan") {
  try {
    const request = await parsePlanRequest(arguments_)
    const workspace = await createWorkspaceRepository(nodeFileSystem).load(resolve("."))
    if (workspace === null) throw new Error("Initialize a Specta workspace before planning.")
    const result = await createPlanWorkflow().execute({ workspace, ...request })
    console.log("Completed planning stage: " + result.stage + ".")
    console.log("Generated " + result.artifacts.documents.length + " planning artifact(s).")
    console.log("Planning artifacts: " + result.artifacts.rootPath)
  } catch (error) {
    console.error(error instanceof Error ? "specta: " + error.message : "specta: Unable to create a plan.")
    process.exitCode = 1
  }
} else if (command === "design" || command === "approve-design" || command === "scaffold") {
  try {
    const workspace = await createWorkspaceRepository(nodeFileSystem).load(resolve("."))
    if (workspace === null) throw new Error("Initialize a Specta workspace before running this workflow.")
    if (command === "design") {
      const request = await parseDesignRequest(arguments_)
      const design = await createTechnicalDesignWorkflow().execute({ workspace, ...request })
      console.log("Created Technical Design " + design.id + " (draft).")
    } else if (command === "approve-design") {
      const identifier = arguments_.at(0)
      if (identifier === undefined || arguments_.length !== 1) throw new Error("Usage: specta approve-design <design-id>")
      const design = await createTechnicalDesignApprovalWorkflow().approve(workspace, identifier as TechnicalDesignId)
      console.log("Approved Technical Design " + design.id + ".")
    } else {
      const [identifier, phase, runId] = arguments_
      if (identifier === undefined || (phase !== "--prepare" && phase !== "--finalize")) {
        throw new Error("Usage: specta scaffold <design-id> --prepare | specta scaffold <design-id> --finalize <scaffold-run-id>")
      }
      const workflow = createScaffoldWorkflow()
      if (phase === "--prepare") {
        if (runId !== undefined) throw new Error("The scaffold prepare phase does not accept a run ID.")
        const plan = await workflow.prepare({ workspace, designId: identifier as TechnicalDesignId })
        console.log("Prepared Scaffold Run " + plan.id + ".")
        console.log(JSON.stringify(plan, null, 2))
      } else {
        if (runId === undefined || arguments_.length !== 3) throw new Error("The scaffold finalize phase requires a scaffold-run-id.")
        const result = await workflow.finalize({ workspace, scaffoldRunId: runId as ScaffoldRunId })
        console.log("Created " + result.createdPaths.length + " scaffold file(s).")
        if (result.preservedPaths.length > 0) console.log("Preserved existing files: " + result.preservedPaths.join(", "))
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? "specta: " + error.message : "specta: Unable to execute workflow.")
    process.exitCode = 1
  }
} else {
  console.error("Usage: specta init [path] [--skill-target <target>] | specta compile | specta context <epic-id> [--run <implementation-run-id>] [--max-tokens <count>] [--json] | specta plan [foundation <brief> | architecture | roadmap | epics | <brief>] | specta design <epic-id> --draft <draft.json> | specta approve-design <design-id> | specta scaffold <design-id> --prepare | --finalize <scaffold-run-id>")
  process.exitCode = 1
}

function parseContextRequest(arguments_: string[]): {
  epicId: string
  implementationRunId?: string
  workflow: "implement"
  maxTokens?: number
  output: "markdown" | "json"
} {
  const epicId = arguments_[0]
  if (!epicId || epicId.startsWith("-")) throw new Error("Usage: specta context <epic-id> [--run <implementation-run-id>] [--max-tokens <count>] [--json]")
  let implementationRunId: string | undefined
  let maxTokens: number | undefined
  let output: "markdown" | "json" = "markdown"
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === "--json") {
      output = "json"
      continue
    }
    if (argument === "--run") {
      implementationRunId = arguments_[index + 1]
      if (!implementationRunId || implementationRunId.startsWith("-")) throw new Error("--run requires an Implementation Run ID.")
      index += 1
      continue
    }
    if (argument === "--max-tokens") {
      const value = arguments_[index + 1]
      maxTokens = value === undefined ? Number.NaN : Number(value)
      if (!Number.isInteger(maxTokens) || maxTokens <= 0) throw new Error("--max-tokens requires a positive integer.")
      index += 1
      continue
    }
    throw new Error("Unknown context option: " + argument + ".")
  }
  return {
    epicId,
    workflow: "implement",
    output,
    ...(implementationRunId ? { implementationRunId } : {}),
    ...(maxTokens ? { maxTokens } : {}),
  }
}

async function parseDesignRequest(arguments_: string[]): Promise<{ targetId: never, draft: never, feedback?: string }> {
  const [targetId, option, draftPath, ...rest] = arguments_
  if (targetId === undefined || option !== "--draft" || draftPath === undefined) throw new Error("Usage: specta design <epic-id> --draft <draft.json> [--feedback <changes>]")
  const feedback = rest[0] === "--feedback" ? rest.slice(1).join(" ").trim() : ""
  if (rest.length > 0 && feedback.length === 0) throw new Error("Usage: specta design <epic-id> --draft <draft.json> [--feedback <changes>]")
  let draft: unknown
  try { draft = JSON.parse(await readFile(resolve(draftPath), "utf8")) } catch { throw new Error("Unable to read Technical Design draft: " + draftPath + ".") }
  return { targetId: targetId as never, draft: draft as never, ...(feedback ? { feedback } : {}) }
}

async function parsePlanRequest(arguments_: string[]): Promise<PlanWorkflowInput> {
  const draftIndex = arguments_.indexOf("--draft")
  const draftPath = draftIndex >= 0 ? arguments_[draftIndex + 1] : undefined
  if (draftIndex >= 0 && draftPath === undefined) throw new Error("--draft requires a JSON draft path.")
  const values = draftIndex >= 0 ? arguments_.slice(0, draftIndex) : arguments_
  let draft: unknown
  if (draftPath) { try { draft = JSON.parse(await readFile(resolve(draftPath), "utf8")) } catch { throw new Error("Unable to read planning draft: " + draftPath + ".") } }
  const [first, ...rest] = values
  if (first === "foundation") {
    const brief = rest.join(" ").trim()
    if (brief.length === 0) throw new Error("Usage: specta plan foundation <brief>")
    return { stage: "foundation", brief, ...(draft === undefined ? {} : { draft: draft as FoundationDraft }) }
  }
  if (first === "architecture") {
    const guidance = rest.join(" ").trim()
    return {
      stage: "architecture",
      ...(guidance.length === 0 ? {} : { guidance }),
      ...(draft === undefined ? {} : { draft: draft as ArchitectureDraft }),
    }
  }
  if (first === "roadmap" || first === "epics") {
    if (rest.length > 0) throw new Error("The " + first + " planning stage does not accept a brief.")
    return first === "roadmap"
      ? { stage: "roadmap", ...(draft === undefined ? {} : { draft: draft as RoadmapDraft }) }
      : { stage: "epics", ...(draft === undefined ? {} : { draft: draft as EpicsDraft }) }
  }
  const brief = values.join(" ").trim()
  return brief.length > 0
    ? { stage: "next", brief, ...(draft === undefined ? {} : { draft: draft as NonNullable<PlanWorkflowInput["draft"]> }) }
    : { stage: "next", ...(draft === undefined ? {} : { draft: draft as NonNullable<PlanWorkflowInput["draft"]> }) }
}

function parseInitializeRequest(arguments_: string[]): InitializeWorkspaceRequest {
  const skillTargets: string[] = []
  let target = "."
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === undefined) continue
    if (argument === "--skill-target" || argument === "--agent") {
      const target = arguments_[index + 1]
      if (target === undefined || target.startsWith("-")) {
        throw new Error(argument + " requires a target name.")
      }
      skillTargets.push(target)
      index += 1
      continue
    }
    if (argument.startsWith("-") || target !== ".") {
      throw new Error("Usage: specta init [path] [--skill-target <target>]")
    }
    target = argument
  }
  const request: InitializeWorkspaceRequest = { rootPath: resolve(target) }
  if (skillTargets.length > 0) {
    request.skillTargets = skillTargets as NonNullable<InitializeWorkspaceRequest["skillTargets"]>
  }
  return request
}
