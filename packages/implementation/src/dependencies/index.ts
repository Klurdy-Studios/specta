import type {
  PlanningState,
  ResolvedTechnicalDependency,
  TechnicalDependency,
  TechnicalDesign,
} from "@specta/core"

export interface TechnicalDependencyResolver {
  resolve(
    design: TechnicalDesign,
    designs: TechnicalDesign[],
    planning: PlanningState,
  ): ResolvedTechnicalDependency[]
}

export function createTechnicalDependencyResolver(): TechnicalDependencyResolver {
  return {
    resolve(design, designs, planning) {
      return design.dependencies.map((dependency) => resolveDependency(dependency, design, designs, planning))
    },
  }
}

function resolveDependency(
  dependency: TechnicalDependency,
  design: TechnicalDesign,
  designs: TechnicalDesign[],
  planning: PlanningState,
): ResolvedTechnicalDependency {
  const target = designs.find((candidate) => candidate.id === dependency.targetDesignId)
  if (target === undefined) return blocked(dependency, "Target Technical Design does not exist.")
  const epicOrder = planning.epics?.map((epic) => epic.id) ?? []
  const targetIndex = epicOrder.indexOf(target.targetId)
  const designIndex = epicOrder.indexOf(design.targetId)
  if (targetIndex < 0 || designIndex < 0) {
    return blocked(dependency, "Technical Design Epic is not present in current planning state.")
  }
  if (targetIndex >= designIndex) {
    return blocked(dependency, "Cross-Epic dependencies must target an earlier Epic.")
  }
  if (!["approved", "scaffolded"].includes(target.status)) {
    return blocked(dependency, "Target Technical Design is not approved.")
  }
  if (dependency.kind === "technical-design") {
    return resolved(dependency, target.status === "scaffolded" ? "available" : "planned", target.id)
  }
  const file = target.modules.flatMap((module) => module.files).find((candidate) => candidate.path === dependency.filePath)
  if (file === undefined) return blocked(dependency, "Target file is not declared by the target Technical Design.")
  if (dependency.kind === "symbol" && !file.exports.some((symbol) => symbol.name === dependency.symbolName)) {
    return blocked(dependency, "Target symbol is not declared by the target file.")
  }
  const available = target.scaffoldedPaths?.includes(file.path) ?? false
  const entity = dependency.kind === "symbol" ? file.path + "#" + dependency.symbolName : file.path
  return resolved(dependency, available ? "available" : "planned", entity)
}

function blocked(dependency: TechnicalDependency, reason: string): ResolvedTechnicalDependency {
  return { dependency, status: "blocked", reason }
}

function resolved(
  dependency: TechnicalDependency,
  status: "planned" | "available",
  resolvedEntityId: string,
): ResolvedTechnicalDependency {
  return { dependency, status, resolvedEntityId }
}
