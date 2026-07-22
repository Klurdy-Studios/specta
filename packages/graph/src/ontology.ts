import { defineEdge, defineGraph, defineNode } from "@nicia-ai/typegraph"
import {
  acceptanceCriterionSchema,
  architectureSchema,
  constitutionSchema,
  epicImplementationStateSchema,
  epicSchema,
  packageManagerSchema,
  projectProfileSchema,
  projectSchema,
  roadmapSchema,
  scaffoldPlanSchema,
  storySchema,
  taskSchema,
  technicalDesignSchema,
  technicalModuleSchema,
  visionSchema,
  workflowRunSchema,
} from "@specta/core"
import { z } from "zod"
import { validationReportSchema } from "@specta/core/validation"
import {
  codeSymbolPropertiesSchema,
  externalDependencyPropertiesSchema,
  filePropertiesSchema,
  specificationDocumentPropertiesSchema,
  specificationEntityPropertiesSchema,
  testPropertiesSchema,
} from "./analysis/snapshot.ts"

export const VisionNode = defineNode("Vision", { schema: visionSchema.omit({ id: true }) })
export const WorkspaceNode = defineNode("Workspace", {
  schema: z.object({ createdAt: z.iso.datetime(), packageManager: packageManagerSchema }).strict(),
})
export const ProjectNode = defineNode("Project", {
  schema: z.object({
    name: projectSchema.shape.name,
    rootPath: projectSchema.shape.rootPath,
    projectKind: projectSchema.shape.kind,
    manifestPath: projectSchema.shape.manifestPath,
  }).strict(),
})
export const ConstitutionNode = defineNode("Constitution", { schema: constitutionSchema.omit({ id: true }) })
export const ArchitectureNode = defineNode("Architecture", { schema: architectureSchema.omit({ id: true }) })
export const RoadmapNode = defineNode("Roadmap", { schema: roadmapSchema.omit({ id: true }) })
export const EpicNode = defineNode("Epic", {
  schema: epicSchema.omit({ id: true, stories: true }).extend({ planningOrder: z.number().int().nonnegative().optional() }),
})
export const StoryNode = defineNode("Story", { schema: storySchema.omit({ id: true, acceptanceCriteria: true, tasks: true }) })
export const AcceptanceCriterionNode = defineNode("AcceptanceCriterion", { schema: acceptanceCriterionSchema.omit({ id: true }) })
export const TaskNode = defineNode("Task", { schema: taskSchema.omit({ id: true }) })
export const TechnicalDesignNode = defineNode("TechnicalDesign", {
  schema: z.object({
    targetId: technicalDesignSchema.shape.targetId,
    target: technicalDesignSchema.shape.target,
    profile: technicalDesignSchema.shape.profile,
    status: technicalDesignSchema.shape.status,
    revision: technicalDesignSchema.shape.revision,
    summary: technicalDesignSchema.shape.summary,
    impactRequests: technicalDesignSchema.shape.impactRequests,
    feedback: technicalDesignSchema.shape.feedback,
    scaffoldedPaths: technicalDesignSchema.shape.scaffoldedPaths,
  }).strict(),
})
export const ModuleNode = defineNode("Module", { schema: technicalModuleSchema.omit({ files: true }) })
export const FileNode = defineNode("File", { schema: filePropertiesSchema })
export const CodeSymbolNode = defineNode("CodeSymbol", { schema: codeSymbolPropertiesSchema })
export const ProjectProfileNode = defineNode("ProjectProfile", { schema: projectProfileSchema })
export const ScaffoldRunNode = defineNode("ScaffoldRun", { schema: scaffoldPlanSchema.omit({ id: true }) })
export const WorkflowRunNode = defineNode("WorkflowRun", { schema: workflowRunSchema })
export const EpicImplementationStateNode = defineNode("EpicImplementationState", { schema: epicImplementationStateSchema })
export const SpecificationDocumentNode = defineNode("SpecificationDocument", { schema: specificationDocumentPropertiesSchema })
export const SpecificationEntityNode = defineNode("SpecificationEntity", { schema: specificationEntityPropertiesSchema })
export const TestNode = defineNode("Test", { schema: testPropertiesSchema })
export const ExternalDependencyNode = defineNode("ExternalDependency", { schema: externalDependencyPropertiesSchema })
export const ContextPacketNode = defineNode("ContextPacket", {
  schema: z.object({
    epicId: z.string().min(1),
    implementationRunId: z.string().min(1),
    sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    estimatedTokens: z.number().int().nonnegative(),
    maxTokens: z.number().int().positive(),
    overBudget: z.boolean(),
  }).strict(),
})
export const ValidationReportNode = defineNode("ValidationReport", {
  schema: z.object({
    epicId: validationReportSchema.shape.epicId,
    implementationRunId: validationReportSchema.shape.implementationRunId,
    mode: validationReportSchema.shape.mode,
    contextFingerprint: validationReportSchema.shape.contextFingerprint,
    sourceFingerprint: validationReportSchema.shape.sourceFingerprint,
    status: validationReportSchema.shape.status,
    summary: validationReportSchema.shape.summary,
  }).strict(),
})

export const ContainsEdge = defineEdge("CONTAINS")
export const DependsOnEdge = defineEdge("DEPENDS_ON")
export const ImplementsEdge = defineEdge("IMPLEMENTS")
export const ImportsEdge = defineEdge("IMPORTS")
export const ExportsEdge = defineEdge("EXPORTS")
export const TestsEdge = defineEdge("TESTS")
export const ReferencesEdge = defineEdge("REFERENCES")
export const TargetsEdge = defineEdge("TARGETS")
export const HasStateEdge = defineEdge("HAS_STATE")
export const ProducesEdge = defineEdge("PRODUCES")
export const IncludesEdge = defineEdge("INCLUDES")
export const ValidatesEdge = defineEdge("VALIDATES")

/** TypeGraph ontology for Specta's unified planning and implementation graph. */
export const workspaceGraph = defineGraph({
  id: "specta_workspace",
  nodes: {
    Workspace: { type: WorkspaceNode }, Project: { type: ProjectNode }, Vision: { type: VisionNode },
    Constitution: { type: ConstitutionNode }, Architecture: { type: ArchitectureNode }, Roadmap: { type: RoadmapNode },
    Epic: { type: EpicNode }, Story: { type: StoryNode }, AcceptanceCriterion: { type: AcceptanceCriterionNode },
    Task: { type: TaskNode }, TechnicalDesign: { type: TechnicalDesignNode }, Module: { type: ModuleNode },
    File: { type: FileNode }, CodeSymbol: { type: CodeSymbolNode }, ProjectProfile: { type: ProjectProfileNode },
    ScaffoldRun: { type: ScaffoldRunNode }, WorkflowRun: { type: WorkflowRunNode },
    EpicImplementationState: { type: EpicImplementationStateNode }, SpecificationDocument: { type: SpecificationDocumentNode },
    SpecificationEntity: { type: SpecificationEntityNode }, Test: { type: TestNode },
    ExternalDependency: { type: ExternalDependencyNode },
    ContextPacket: { type: ContextPacketNode },
    ValidationReport: { type: ValidationReportNode },
  },
  edges: {
    CONTAINS: {
      type: ContainsEdge,
      from: [WorkspaceNode, ProjectNode, EpicNode, StoryNode, TechnicalDesignNode, ModuleNode, FileNode, SpecificationDocumentNode, SpecificationEntityNode],
      to: [ProjectNode, ProjectProfileNode, StoryNode, AcceptanceCriterionNode, TaskNode, ModuleNode, FileNode, CodeSymbolNode, SpecificationEntityNode, TestNode, WorkflowRunNode],
    },
    DEPENDS_ON: {
      type: DependsOnEdge,
      from: [ArchitectureNode, RoadmapNode, EpicNode, TechnicalDesignNode, ModuleNode],
      to: [VisionNode, ConstitutionNode, ArchitectureNode, RoadmapNode, EpicNode, TechnicalDesignNode, ModuleNode, FileNode, CodeSymbolNode, ProjectProfileNode],
    },
    IMPLEMENTS: {
      type: ImplementsEdge,
      from: [EpicNode, TechnicalDesignNode, ModuleNode, FileNode, CodeSymbolNode, ScaffoldRunNode],
      to: [ArchitectureNode, EpicNode, TechnicalDesignNode, ModuleNode],
    },
    IMPORTS: { type: ImportsEdge, from: [FileNode], to: [FileNode, ExternalDependencyNode] },
    EXPORTS: { type: ExportsEdge, from: [FileNode], to: [CodeSymbolNode] },
    TESTS: { type: TestsEdge, from: [TestNode], to: [CodeSymbolNode, FileNode] },
    REFERENCES: {
      type: ReferencesEdge,
      from: [SpecificationDocumentNode, SpecificationEntityNode, FileNode, CodeSymbolNode],
      to: [VisionNode, ConstitutionNode, ArchitectureNode, RoadmapNode, EpicNode, StoryNode, AcceptanceCriterionNode, TaskNode, SpecificationDocumentNode, SpecificationEntityNode, FileNode, CodeSymbolNode],
    },
    TARGETS: { type: TargetsEdge, from: [WorkflowRunNode], to: [WorkspaceNode, EpicNode, TechnicalDesignNode] },
    HAS_STATE: { type: HasStateEdge, from: [EpicNode], to: [EpicImplementationStateNode] },
    PRODUCES: {
      type: ProducesEdge,
      from: [WorkflowRunNode],
      to: [VisionNode, ConstitutionNode, ArchitectureNode, RoadmapNode, EpicNode, StoryNode, AcceptanceCriterionNode, TaskNode, TechnicalDesignNode, ModuleNode, FileNode, CodeSymbolNode, TestNode, ContextPacketNode, ValidationReportNode],
    },
    INCLUDES: {
      type: IncludesEdge,
      from: [ContextPacketNode],
      to: [VisionNode, ConstitutionNode, ArchitectureNode, RoadmapNode, EpicNode, StoryNode, AcceptanceCriterionNode, TaskNode, TechnicalDesignNode, ModuleNode, FileNode, CodeSymbolNode, SpecificationDocumentNode, SpecificationEntityNode, TestNode, ExternalDependencyNode],
    },
    VALIDATES: {
      type: ValidatesEdge,
      from: [ValidationReportNode, TestNode],
      to: [ProjectNode, ArchitectureNode, EpicNode, StoryNode, AcceptanceCriterionNode, TechnicalDesignNode, ModuleNode, FileNode, CodeSymbolNode, TestNode, ExternalDependencyNode],
    },
  },
})

/** Runtime node-kind registry derived from the canonical ontology. */
export const workspaceGraphNodeKinds = Object.keys(workspaceGraph.nodes) as Array<keyof typeof workspaceGraph.nodes>

/** Runtime edge-kind registry derived from the canonical ontology. */
export const workspaceGraphEdgeKinds = Object.keys(workspaceGraph.edges) as Array<keyof typeof workspaceGraph.edges>
