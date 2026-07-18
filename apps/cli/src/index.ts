#!/usr/bin/env node
import { resolve } from "node:path"
import { readFile } from "node:fs/promises"
import type { ArchitectureDraft, EpicsDraft, FoundationDraft, RoadmapDraft } from "@specta/core"
import { createWorkspaceRepository } from "@specta/core/config"
import { nodeFileSystem } from "@specta/core/filesystem"
import { createWorkspaceInitializer, type InitializeWorkspaceRequest } from "@specta/core/workspace"
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
    } else {
      const identifier = arguments_.at(0)
      if (identifier === undefined || arguments_.length !== 1) throw new Error("Usage: specta " + command + " <design-id>")
      if (command === "approve-design") {
      const design = await createTechnicalDesignApprovalWorkflow().approve(workspace, identifier as never)
      console.log("Approved Technical Design " + design.id + ".")
      } else {
      const result = await createScaffoldWorkflow().execute({ workspace, designId: identifier as never })
      console.log("Created " + result.createdPaths.length + " scaffold file(s).")
      if (result.preservedPaths.length > 0) console.log("Preserved existing files: " + result.preservedPaths.join(", "))
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? "specta: " + error.message : "specta: Unable to execute workflow.")
    process.exitCode = 1
  }
} else {
  console.error("Usage: specta init [path] [--skill-target <target>] | specta plan [foundation <brief> | architecture | roadmap | epics | <brief>] | specta design <epic-id> [--feedback <changes>] | specta approve-design <design-id> | specta scaffold <design-id>")
  process.exitCode = 1
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
