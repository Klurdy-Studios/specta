import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { codingAgentTokenUsageSchema } from "@specta/core"
import { createWorkspaceRepository } from "@specta/core/config"
import { nodeFileSystem } from "@specta/core/filesystem"
import { validationEvidenceSchema } from "@specta/core/validation"
import {
  createImplementationWorkflowCoordinator,
  renderImplementationFinalization,
  renderImplementationPreparation,
} from "@specta/implementation"

export interface ImplementCommandResult {
  validationFailed: boolean
}

/** Parses and executes the CLI adapter for the agent-oriented implementation workflow. */
export async function runImplementCommand(arguments_: string[]): Promise<ImplementCommandResult> {
  const parsed = await parseImplementArguments(arguments_)
  const workspace = await createWorkspaceRepository(nodeFileSystem).load(resolve("."))
  if (!workspace) throw new Error("Initialize a Specta workspace before implementing an Epic.")
  const coordinator = createImplementationWorkflowCoordinator()
  if (parsed.phase === "prepare") {
    const preparation = await coordinator.prepare({
      workspace,
      selector: parsed.target === "next"
        ? { kind: "next" }
        : { kind: "epic", epicId: parsed.target },
      ...(parsed.maxContextTokens ? { maxContextTokens: parsed.maxContextTokens } : {}),
    })
    console.log(parsed.json
      ? JSON.stringify(preparation, null, 2)
      : renderImplementationPreparation(preparation))
    return { validationFailed: false }
  }
  const finalization = await coordinator.finalize({
    workspace,
    implementationRunId: parsed.target,
    evidence: parsed.evidence,
    ...(parsed.tokenUsage ? { codingAgentTokenUsage: parsed.tokenUsage } : {}),
  })
  console.log(parsed.json
    ? JSON.stringify(finalization, null, 2)
    : renderImplementationFinalization(finalization))
  return { validationFailed: finalization.report.status === "failed" }
}

type ParsedImplementArguments =
  | { phase: "prepare"; target: string; maxContextTokens?: number; json: boolean }
  | {
    phase: "finalize"
    target: string
    evidence: ReturnType<typeof validationEvidenceSchema.parse>
    tokenUsage?: ReturnType<typeof codingAgentTokenUsageSchema.parse>
    json: boolean
  }

async function parseImplementArguments(arguments_: string[]): Promise<ParsedImplementArguments> {
  const target = arguments_[0]
  const phase = arguments_[1]
  if (!target || target.startsWith("-") || (phase !== "--prepare" && phase !== "--finalize")) {
    throw new Error(usage())
  }
  let json = false
  let maxContextTokens: number | undefined
  let evidencePath: string | undefined
  let tokenUsagePath: string | undefined
  for (let index = 2; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === "--json") {
      json = true
    } else if (argument === "--max-tokens" && phase === "--prepare") {
      const raw = arguments_[++index]
      maxContextTokens = raw === undefined ? undefined : Number(raw)
      if (!Number.isInteger(maxContextTokens) || (maxContextTokens ?? 0) <= 0) {
        throw new Error("--max-tokens requires a positive integer.")
      }
    } else if (argument === "--evidence" && phase === "--finalize") {
      evidencePath = requiredPath(arguments_[++index], "--evidence")
    } else if (argument === "--token-usage" && phase === "--finalize") {
      tokenUsagePath = requiredPath(arguments_[++index], "--token-usage")
    } else {
      throw new Error("Unknown implement option: " + argument + ".\n" + usage())
    }
  }
  if (phase === "--prepare") return {
    phase: "prepare",
    target,
    ...(maxContextTokens ? { maxContextTokens } : {}),
    json,
  }
  if (!evidencePath) throw new Error(usage())
  const evidenceValue = await readJson(evidencePath, "validation evidence")
  const tokenUsageValue = tokenUsagePath
    ? codingAgentTokenUsageSchema.parse(await readJson(tokenUsagePath, "coding-agent token usage"))
    : undefined
  return {
    phase: "finalize",
    target,
    evidence: validationEvidenceSchema.parse(evidenceValue),
    ...(tokenUsageValue ? { tokenUsage: tokenUsageValue } : {}),
    json,
  }
}

function requiredPath(value: string | undefined, option: string): string {
  if (!value || value.startsWith("-")) throw new Error(option + " requires a JSON file path.")
  return value
}

async function readJson(path: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(resolve(path), "utf8"))
  } catch (error) {
    throw new Error("Unable to read " + label + ": " + path + ".", { cause: error })
  }
}

function usage(): string {
  return "Usage: specta implement <epic-id|next> --prepare [--max-tokens <count>] [--json] | "
    + "specta implement <implementation-run-id> --finalize --evidence <evidence.json> "
    + "[--token-usage <token-usage.json>] [--json]"
}
