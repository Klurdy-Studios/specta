#!/usr/bin/env node
import { resolve } from "node:path"
import { createWorkspaceRepository } from "@specta/config"
import { nodeFileSystem } from "@specta/filesystem"
import { createPlanWorkflow } from "@specta/workflow"
import { createWorkspaceInitializer, type InitializeWorkspaceRequest } from "@specta/workspace"

const [command, ...arguments_] = process.argv.slice(2)

if (command === "init") {
  try {
    const request = parseInitializeRequest(arguments_)
    const result = await createWorkspaceInitializer().initialize(request)
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
    const request = parsePlanRequest(arguments_)
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
} else {
  console.error("Usage: specta init [path] [--skill-target <target>] | specta plan [foundation <brief> | architecture | roadmap | epics | <brief>]")
  process.exitCode = 1
}

function parsePlanRequest(arguments_: string[]): { stage?: "foundation" | "architecture" | "roadmap" | "epics" | "next", brief?: string } {
  const [first, ...rest] = arguments_
  if (first === "foundation") {
    const brief = rest.join(" ").trim()
    if (brief.length === 0) throw new Error("Usage: specta plan foundation <brief>")
    return { stage: "foundation", brief }
  }
  if (first === "architecture" || first === "roadmap" || first === "epics") {
    if (rest.length > 0) throw new Error("The " + first + " planning stage does not accept a brief.")
    return { stage: first }
  }
  const brief = arguments_.join(" ").trim()
  return brief.length > 0 ? { stage: "next", brief } : { stage: "next" }
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
