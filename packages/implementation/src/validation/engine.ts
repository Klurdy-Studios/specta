import { createHash } from "node:crypto"
import { join, posix } from "node:path"
import type { Epic, TechnicalDesign, Workspace } from "@specta/core"
import type { FileSystem } from "@specta/core/filesystem"
import { nodeFileSystem } from "@specta/core/filesystem"
import {
  validationEvidenceSchema,
  type ValidationCheck,
  type ValidationCommandRunner,
  type ValidationEvidence,
  type ValidationReport,
} from "@specta/core/validation"
import {
  createAnalysisGraphRepository,
  createContextEngine,
  createPlanningGraphRepository,
  createTechnicalDesignGraphRepository,
  createValidationReportRepository,
  createWorkflowStateRepository,
  normalizePath,
  type AnalysisGraphSnapshot,
  type AnalysisGraphNode,
  type ContextPacket,
  type TechnicalDesignGraphRepository,
  type ValidationReportRepository,
  type WorkflowStateRepository,
} from "@specta/graph"
import { createLanguageAdapterRegistry, type LanguageAdapterRegistry } from "../language/index.ts"
import { createValidationCommandRunner, discoverValidationCommands } from "./commands.ts"
import { validationCheck, validationReport } from "./rules.ts"

export interface ImplementationValidationRequest {
  workspace: Workspace
  epicId: string
  implementationRunId?: string
  evidence?: ValidationEvidence
  mode?: "full" | "structural"
}

export interface ImplementationValidationEngine {
  /** Validates and persists one Epic-scoped report without mutating implementation status. */
  validate(request: ImplementationValidationRequest): Promise<ValidationReport>
}

export interface ImplementationValidationEngineOptions {
  fileSystem?: FileSystem
  commandRunner?: ValidationCommandRunner
  languages?: LanguageAdapterRegistry
  designs?: TechnicalDesignGraphRepository
  reports?: ValidationReportRepository
  workflowState?: WorkflowStateRepository
  contextEngine?: ReturnType<typeof createContextEngine>
}

/** Creates the deterministic implementation Validation Engine. */
export function createImplementationValidationEngine(
  options: ImplementationValidationEngineOptions = {},
): ImplementationValidationEngine {
  const fileSystem = options.fileSystem ?? nodeFileSystem
  const commandRunner = options.commandRunner ?? createValidationCommandRunner()
  const languages = options.languages ?? createLanguageAdapterRegistry()
  const designs = options.designs ?? createTechnicalDesignGraphRepository(fileSystem)
  const reports = options.reports ?? createValidationReportRepository(fileSystem)
  const workflowState = options.workflowState ?? createWorkflowStateRepository(fileSystem)
  const contextEngine = options.contextEngine ?? createContextEngine({ fileSystem })
  return {
    async validate(request) {
      const mode = request.mode ?? "full"
      const planning = await createPlanningGraphRepository(fileSystem).loadPlanningState(request.workspace)
      if (!planning) throw new Error("Compile planning before validating implementation.")
      const epic = planning.epics?.find((candidate) => candidate.id === request.epicId)
      if (!epic) throw new Error("Epic not found in the Workspace Graph: " + request.epicId + ".")
      const architecture = planning.architecture
      if (!architecture) throw new Error("Implementation validation requires Architecture planning.")
      const evidence = validationEvidenceSchema.parse(request.evidence ?? { epicId: epic.id, criteria: [] })
      if (evidence.epicId !== epic.id) throw new Error("Validation evidence must target the selected Epic.")
      const run = request.implementationRunId
        ? await workflowState.getRun(request.workspace, request.implementationRunId)
        : null
      if (request.implementationRunId && (!run || run.workflow !== "implement" || run.targetId !== epic.id)) {
        throw new Error("Validation request and Implementation Run must target the same Epic.")
      }
      const analysis = await createAnalysisGraphRepository(fileSystem).load(request.workspace)
      if (!analysis) throw new Error("Compile source analysis before validating implementation.")
      const context = await contextEngine.compile(request.workspace, {
        epicId: epic.id,
        workflow: "implement",
        ...(request.implementationRunId ? { implementationRunId: request.implementationRunId } : {}),
      })
      const allDesigns = await designs.list(request.workspace)
      const design = allDesigns.find((candidate) => candidate.id === context.technicalDesign.id)
      if (!design) throw new Error("Approved Technical Design is missing from the Workspace Graph.")

      const checks: ValidationCheck[] = []
      const sourceContents = new Map<string, string>()
      const analysisIndex = indexAnalysis(analysis)
      checks.push(validationCheck({
        category: "architecture",
        subject: { kind: "technical-design", id: design.id, name: design.summary },
        status: design.status === "approved" || design.status === "scaffolded" ? "passed" : "failed",
        severity: "error",
        message: "Technical Design status is " + design.status + ".",
        evidenceNodeIds: [design.id],
      }))
      await validateDesignedFiles(
        request.workspace,
        design,
        analysisIndex,
        fileSystem,
        languages,
        checks,
        sourceContents,
      )
      validateDependencies(context, checks)
      const resolvedEvidence = resolveAcceptanceEvidence(
        evidence,
        analysisIndex,
        design.profile.rootPath,
      )

      const impactedPaths = [
        ...context.blastRadius.directConsumers,
        ...context.blastRadius.transitiveConsumers,
      ].flatMap((impact) => impact.path ? [impact.path] : [])
      const discovered = await discoverValidationCommands(
        request.workspace,
        design.profile,
        impactedPaths,
        fileSystem,
        [...new Map([...resolvedEvidence.values()].flat().map((test) => [
          normalizePath(test.path) + "\0" + test.framework,
          { path: normalizePath(test.path), framework: test.framework },
        ])).values()],
      )
      const commandResults = []
      if (mode === "full") {
        for (const command of discovered.commands) commandResults.push(await commandRunner.run(command))
        for (const rootPath of discovered.missingTestProjects) checks.push(validationCheck({
          category: "command",
          subject: { kind: "project", path: rootPath },
          status: "failed",
          severity: "error",
          message: "Project has no executable test script.",
        }))
        for (const result of commandResults) checks.push(validationCheck({
          category: "command",
          subject: {
            kind: result.command.kind,
            ...(result.command.projectId ? { id: result.command.projectId } : {}),
            name: result.command.executable + " " + result.command.arguments.join(" "),
            path: result.command.cwd,
          },
          status: result.status,
          severity: "error",
          message: result.status === "passed"
            ? result.command.kind + " command passed."
            : result.command.kind + " command failed" + (result.timedOut ? " after timing out." : "."),
        }))
      } else {
        checks.push(validationCheck({
          category: "command",
          subject: { kind: "runtime-validation" },
          status: "skipped",
          severity: "error",
          message: "Structural validation does not execute project commands and cannot authorize completion.",
        }))
      }

      const testResults = commandResults.filter((result) => result.command.kind === "test")
      const runtimeTestsPassed = mode === "full"
        && discovered.missingTestProjects.length === 0
        && testResults.length > 0
        && testResults.every((result) => result.status === "passed")
      validateAcceptanceCriteria(
        epic,
        evidence,
        resolvedEvidence,
        testResults,
        runtimeTestsPassed,
        checks,
      )
      const dependenciesConform = !checks.some((check) =>
        check.category === "dependency"
        && check.status !== "passed"
        && check.severity === "error",
      )
      validateArchitectureComponents(architecture.id, architecture.components, design, checks, dependenciesConform)
      if (context.blastRadius.truncated) checks.push(validationCheck({
        category: "test",
        subject: { kind: "blast-radius", id: epic.id },
        status: "skipped",
        severity: "warning",
        message: "Blast-radius results were truncated; additional downstream validation may be required.",
        evidenceNodeIds: [epic.id],
      }))

      const stableChecks = uniqueChecks(checks)
      const sourceFingerprint = fingerprint({
        context: context.sourceFingerprint,
        files: [...sourceContents].sort(([left], [right]) => left.localeCompare(right)),
        evidence,
        mode,
        commands: commandResults.map((result) => ({
          command: result.command,
          status: result.status,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
        })),
        runRevision: run?.revision,
      })
      const reportId = "validation_" + fingerprint({
        epicId: epic.id,
        runId: request.implementationRunId,
        sourceFingerprint,
      }).slice(0, 16)
      const report = validationReport({
        id: reportId,
        epicId: epic.id,
        ...(request.implementationRunId ? { implementationRunId: request.implementationRunId } : {}),
        mode,
        contextFingerprint: context.sourceFingerprint,
        sourceFingerprint,
        checks: stableChecks,
        commands: commandResults,
      })
      await reports.save(request.workspace, report)
      return report
    },
  }
}

async function validateDesignedFiles(
  workspace: Workspace,
  design: TechnicalDesign,
  analysis: ValidationAnalysisIndex,
  fileSystem: FileSystem,
  languages: LanguageAdapterRegistry,
  checks: ValidationCheck[],
  sourceContents: Map<string, string>,
): Promise<void> {
  for (const module of design.modules) {
    for (const file of module.files) {
      const workspacePath = projectPath(design.profile.rootPath, file.path)
      const absolutePath = join(workspace.rootPath, workspacePath)
      const exists = await fileSystem.exists(absolutePath)
      const parsed = analysis.sourceFiles.get(workspacePath)
      let content: string | undefined
      if (exists) {
        content = await fileSystem.readText(absolutePath)
        sourceContents.set(workspacePath, content)
      }
      const languageValidation = content === undefined
        ? undefined
        : languages.resolve(file.language).validateFile(file, content, { declarationOnly: false })
      const analyzedWhenRequired = file.kind === "configuration" || parsed !== undefined
      const valid = exists && analyzedWhenRequired && (languageValidation?.valid ?? false)
      const fileNodeId = analysis.fileIds.get(workspacePath)
      checks.push(validationCheck({
        category: "file",
        subject: { kind: file.kind, ...(fileNodeId ? { id: fileNodeId } : {}), path: workspacePath },
        status: valid ? "passed" : "failed",
        severity: "error",
        message: !exists ? "Designed file is missing."
          : !analyzedWhenRequired ? "Designed source file is not present in compiled analysis."
          : languageValidation?.valid ? "Designed file exists and conforms to its language contract."
          : languageValidation?.issues.join(" ") ?? "Designed file is invalid.",
        evidenceNodeIds: fileNodeId ? [fileNodeId] : [],
      }))
      for (const symbol of file.exports) {
        const actual = parsed?.symbols.find((candidate) => candidate.name === symbol.name && candidate.exported)
        const symbolId = analysis.symbolIds.get(workspacePath + "\0" + symbol.name)
        const signatureMatches = symbol.signature === undefined
          || (actual?.signature !== undefined && normalizeSignature(actual.signature).includes(normalizeSignature(symbol.signature)))
        const symbolValid = actual !== undefined && actual.kind === symbol.kind && signatureMatches
        checks.push(validationCheck({
          category: "symbol",
          subject: { kind: symbol.kind, ...(symbolId ? { id: symbolId } : {}), name: symbol.name, path: workspacePath },
          status: symbolValid ? "passed" : "failed",
          severity: "error",
          message: actual === undefined ? "Designed export is missing."
            : actual.kind !== symbol.kind ? "Export kind does not match the approved design."
            : !signatureMatches ? "Export signature does not match the approved design."
            : "Designed export exists with the approved kind and signature.",
          evidenceNodeIds: symbolId ? [symbolId] : [],
        }))
      }
    }
  }
}

function validateDependencies(context: ContextPacket, checks: ValidationCheck[]): void {
  for (const dependency of context.dependencies.filter((item) => item.required)) {
    const valid = dependency.kind === "epic"
      ? dependency.status === "complete"
      : dependency.status !== "blocked" && dependency.reason === undefined
    checks.push(validationCheck({
      category: "dependency",
      subject: {
        kind: dependency.kind,
        ...(dependency.nodeId ? { id: dependency.nodeId } : {}),
        name: dependency.label,
        ...(dependency.path ? { path: dependency.path } : {}),
      },
      status: valid ? "passed" : "failed",
      severity: "error",
      message: valid ? "Required dependency is available."
        : dependency.reason ?? "Required predecessor Epic is not complete.",
      evidenceNodeIds: dependency.nodeId ? [dependency.nodeId] : [],
    }))
  }
}

function validateAcceptanceCriteria(
  epic: Epic,
  evidence: ValidationEvidence,
  resolvedEvidence: Map<string, TestNode[]>,
  testResults: Awaited<ReturnType<ValidationCommandRunner["run"]>>[],
  runtimeTestsPassed: boolean,
  checks: ValidationCheck[],
): void {
  const evidenceByCriterion = new Map(evidence.criteria.map((item) => [item.criterionId, item]))
  for (const story of epic.stories) {
    const criterionChecks: ValidationCheck[] = []
    for (const criterion of story.acceptanceCriteria) {
      const criterionEvidence = evidenceByCriterion.get(criterion.id)
      const resolvedTests = resolvedEvidence.get(criterion.id) ?? []
      const completeEvidence = criterionEvidence !== undefined
        && resolvedTests.length === criterionEvidence.tests.length
      const targetedTestPassed = (test: TestNode) =>
        testResults.some((result) =>
          result.status === "passed" && result.command.testPaths?.includes(normalizePath(test.path)),
        )
      const targetedTestsPassed = resolvedTests.length > 0 && resolvedTests.every(targetedTestPassed)
      const passed = completeEvidence && runtimeTestsPassed && targetedTestsPassed
      const check = validationCheck({
        category: "acceptance-criterion",
        subject: { kind: "acceptance-criterion", id: criterion.id, name: criterion.description },
        status: passed ? "passed" : "failed",
        severity: "error",
        message: !criterionEvidence ? "Acceptance criterion has no test evidence."
          : !completeEvidence ? "One or more evidence tests are missing from compiled analysis."
          : !runtimeTestsPassed ? "Evidence exists, but runtime test validation did not pass."
          : !targetedTestsPassed ? "Evidence tests were not targeted by a successful test command."
          : "Acceptance criterion is covered by verified passing tests.",
        evidenceNodeIds: resolvedTests.map((test) => test.id),
      })
      checks.push(check)
      criterionChecks.push(check)
      for (const test of resolvedTests) checks.push(validationCheck({
        category: "test",
        subject: { kind: "test", id: test.id, name: test.name, path: test.path },
        status: runtimeTestsPassed && targetedTestPassed(test) ? "passed" : "failed",
        severity: "error",
        message: runtimeTestsPassed && targetedTestPassed(test) ? "Evidence test exists and its targeted project test command passed."
          : "Evidence test exists, but runtime test validation did not pass.",
        evidenceNodeIds: [test.id, criterion.id],
      }))
    }
    const storyPassed = criterionChecks.length > 0 && criterionChecks.every((check) => check.status === "passed")
    checks.push(validationCheck({
      category: "requirement",
      subject: { kind: "story", id: story.id, name: story.title },
      status: storyPassed ? "passed" : "failed",
      severity: "error",
      message: storyPassed ? "Every acceptance criterion for this Story passed."
        : "One or more acceptance criteria for this Story failed.",
      evidenceNodeIds: [story.id, ...story.acceptanceCriteria.map((criterion) => criterion.id)],
    }))
  }
  const storyChecks = checks.filter((check) => check.category === "requirement" && check.subject.kind === "story")
  checks.push(validationCheck({
    category: "requirement",
    subject: { kind: "epic", id: epic.id, name: epic.title },
    status: storyChecks.length > 0 && storyChecks.every((check) => check.status === "passed") ? "passed" : "failed",
    severity: "error",
    message: storyChecks.every((check) => check.status === "passed")
      ? "Every Story in the Epic passed validation."
      : "One or more Stories in the Epic failed validation.",
    evidenceNodeIds: [epic.id, ...epic.stories.map((story) => story.id)],
  }))
}

type TestNode = Extract<AnalysisGraphNode, { type: "TEST" }>

interface ValidationAnalysisIndex {
  sourceFiles: Map<string, AnalysisGraphSnapshot["analysis"]["sourceFiles"][number]>
  fileIds: Map<string, string>
  symbolIds: Map<string, string>
  tests: TestNode[]
  testsByPathAndName: Map<string, TestNode>
}

function indexAnalysis(analysis: AnalysisGraphSnapshot): ValidationAnalysisIndex {
  const sourceFiles = new Map(analysis.analysis.sourceFiles.map((file) => [normalizePath(file.path), file]))
  const fileIds = new Map<string, string>()
  const symbolIds = new Map<string, string>()
  const tests: TestNode[] = []
  const testsByPathAndName = new Map<string, TestNode>()
  for (const node of analysis.nodes) {
    if (node.type === "FILE") fileIds.set(normalizePath(node.path), node.id)
    else if (node.type === "CODE_SYMBOL" && node.path) {
      symbolIds.set(normalizePath(node.path) + "\0" + node.name, node.id)
    } else if (node.type === "TEST") {
      tests.push(node)
      testsByPathAndName.set(normalizePath(node.path) + "\0" + node.name, node)
    }
  }
  return { sourceFiles, fileIds, symbolIds, tests, testsByPathAndName }
}

function resolveAcceptanceEvidence(
  evidence: ValidationEvidence,
  analysis: ValidationAnalysisIndex,
  projectRootPath: string,
): Map<string, TestNode[]> {
  return new Map(evidence.criteria.map((criterion) => [criterion.criterionId, criterion.tests.flatMap((expected) => {
    const paths = [normalizePath(expected.path), projectPath(projectRootPath, expected.path)]
    if (expected.name) {
      for (const path of paths) {
        const match = analysis.testsByPathAndName.get(path + "\0" + expected.name)
        if (match) return [match]
      }
      return []
    }
    const match = analysis.tests.find((test) => paths.includes(normalizePath(test.path)))
    return match ? [match] : []
  })]))
}

function validateArchitectureComponents(
  architectureId: string,
  components: string[],
  design: TechnicalDesign,
  checks: ValidationCheck[],
  dependenciesConform: boolean,
): void {
  for (const component of components) {
    const componentKey = normalizedArchitectureLabel(component)
    const modules = design.modules.filter((module) =>
      [module.name, module.path, module.purpose].some((value) => normalizedArchitectureLabel(value) === componentKey),
    )
    const paths = new Set(modules.flatMap((module) =>
      module.files.map((file) => projectPath(design.profile.rootPath, file.path)),
    ))
    const structuralChecks = checks.filter((check) =>
      (check.category === "file" || check.category === "symbol")
      && check.subject.path !== undefined
      && paths.has(normalizePath(check.subject.path)),
    )
    const passed = modules.length > 0
      && structuralChecks.length > 0
      && structuralChecks.every((check) => check.status === "passed")
      && dependenciesConform
    checks.push(validationCheck({
      category: "architecture",
      subject: { kind: "architecture-component", id: architectureId, name: component },
      status: passed ? "passed" : "failed",
      severity: "error",
      message: modules.length === 0
        ? "No Technical Design module explicitly maps to this architecture component."
        : passed
          ? "Mapped Technical Design modules and their implementation conform to this architecture component."
          : "A mapped module, file, symbol, or required dependency failed validation.",
      evidenceNodeIds: [
        architectureId,
        design.id,
        ...structuralChecks.flatMap((check) => check.evidenceNodeIds),
      ],
    }))
  }
}

function normalizedArchitectureLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function projectPath(rootPath: string, filePath: string): string {
  return normalizePath(rootPath === "." ? filePath : posix.join(rootPath, filePath))
}

function normalizeSignature(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function uniqueChecks(checks: ValidationCheck[]): ValidationCheck[] {
  return [...new Map(checks.map((check) => [check.id, check])).values()]
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}
