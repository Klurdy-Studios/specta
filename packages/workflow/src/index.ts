import { createWorkspaceRepository, type WorkspaceRepository } from "@specta/config"
import type { PlanningArtifactSet, Workspace } from "@specta/core"
import { nodeFileSystem } from "@specta/filesystem"
import type {
  Planner,
  PlanningArtifactRepository,
  PlanningGraphUpdater,
} from "@specta/planner"
import {
  createPlanner,
  createPlanningArtifactRepository,
  createPlanningGraphUpdater,
} from "@specta/planner"

export interface PlanWorkflowRequest {
  workspace: Workspace
  brief: string
}

export interface PlanWorkflowResult {
  plan: Awaited<ReturnType<Planner["createPlan"]>>
  artifacts: PlanningArtifactSet
  workspace: Workspace
}

export interface PlanWorkflow {
  execute(request: PlanWorkflowRequest): Promise<PlanWorkflowResult>
}

export function createPlanWorkflow(
  planner: Planner = createPlanner(),
  artifacts: PlanningArtifactRepository = createPlanningArtifactRepository(),
  graphUpdater: PlanningGraphUpdater = createPlanningGraphUpdater(),
  workspaceRepository: WorkspaceRepository = createWorkspaceRepository(nodeFileSystem),
): PlanWorkflow {
  return {
    async execute(request) {
      const plan = await planner.createPlan({ workspace: request.workspace, brief: request.brief })
      const artifactSet = await artifacts.save(request.workspace, plan)
      await graphUpdater.apply(request.workspace, plan.relationships)
      const artifactPath = (kind: PlanningArtifactSet["documents"][number]["kind"]): string | undefined =>
        artifactSet.documents.find((document) => document.kind === kind)?.path
      const workspace: Workspace = {
        ...request.workspace,
        artifacts: {
          ...request.workspace.artifacts,
          visionPath: artifactPath("vision")!,
          constitutionPath: artifactPath("constitution")!,
          architecturePath: artifactPath("architecture")!,
          roadmapPath: artifactPath("roadmap")!,
          planningPath: artifactSet.rootPath,
        },
      }
      await workspaceRepository.save(workspace)
      return { plan, artifacts: artifactSet, workspace }
    },
  }
}
