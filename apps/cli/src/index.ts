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
    const integrations = result.workspace.workflow.integrations
    console.log("Configured Agent Integrations: " + (integrations.length === 0 ? "none" : integrations.join(", ")) + ".")
  } catch (error) {
    console.error(error instanceof Error ? "specta: " + error.message : "specta: Unable to initialize workspace.")
    process.exitCode = 1
  }
} else if (command === "plan") {
  try {
    const brief = arguments_.join(" ").trim()
    if (brief.length === 0) throw new Error("Usage: specta plan <brief>")
    const workspace = await createWorkspaceRepository(nodeFileSystem).load(resolve("."))
    if (workspace === null) throw new Error("Initialize a Specta workspace before planning.")
    const result = await createPlanWorkflow().execute({ workspace, brief })
    console.log("Generated " + result.artifacts.documents.length + " planning artifacts.")
    console.log("Planning artifacts: " + result.artifacts.rootPath)
  } catch (error) {
    console.error(error instanceof Error ? "specta: " + error.message : "specta: Unable to create a plan.")
    process.exitCode = 1
  }
} else {
  console.error("Usage: specta init [path] [--agent <integration>] | specta plan <brief>")
  process.exitCode = 1
}

function parseInitializeRequest(arguments_: string[]): InitializeWorkspaceRequest {
  const integrations: string[] = []
  let target = "."
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === undefined) continue
    if (argument === "--agent") {
      const integration = arguments_[index + 1]
      if (integration === undefined || integration.startsWith("-")) {
        throw new Error("--agent requires an integration name.")
      }
      integrations.push(integration)
      index += 1
      continue
    }
    if (argument.startsWith("-") || target !== ".") {
      throw new Error("Usage: specta init [path] [--agent <integration>]")
    }
    target = argument
  }
  const request: InitializeWorkspaceRequest = { rootPath: resolve(target) }
  if (integrations.length > 0) {
    request.integrations = integrations as NonNullable<InitializeWorkspaceRequest["integrations"]>
  }
  return request
}
