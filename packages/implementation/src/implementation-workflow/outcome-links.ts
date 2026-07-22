import type { ValidationReport } from "@specta/core/validation"
import type { ImplementationLink } from "@specta/graph"

/** Derives direct traceability edges exclusively from passing validation evidence. */
export function deriveImplementationLinks(
  report: ValidationReport,
  technicalDesignId: string,
): ImplementationLink[] {
  if (report.status !== "passed") return []
  const links: ImplementationLink[] = []
  for (const check of report.checks) {
    if (check.status !== "passed" || !check.subject.id) continue
    if (check.category === "file") {
      links.push(
        implementsLink(check.subject.id, "File", report.epicId, "Epic"),
        implementsLink(check.subject.id, "File", technicalDesignId, "TechnicalDesign"),
      )
    } else if (check.category === "symbol") {
      links.push(
        implementsLink(check.subject.id, "CodeSymbol", report.epicId, "Epic"),
        implementsLink(check.subject.id, "CodeSymbol", technicalDesignId, "TechnicalDesign"),
      )
    } else if (check.category === "acceptance-criterion") {
      for (const testId of check.evidenceNodeIds) {
        links.push({
          kind: "VALIDATES",
          sourceId: testId,
          sourceKind: "Test",
          targetId: check.subject.id,
          targetKind: "AcceptanceCriterion",
        })
      }
    }
  }
  return [...new Map(links.map((link) => [
    [link.kind, link.sourceId, link.targetId].join(":"),
    link,
  ])).values()].sort((left, right) =>
    left.kind.localeCompare(right.kind)
    || left.sourceId.localeCompare(right.sourceId)
    || left.targetId.localeCompare(right.targetId),
  )
}

function implementsLink(
  sourceId: string,
  sourceKind: "File" | "CodeSymbol",
  targetId: string,
  targetKind: "Epic" | "TechnicalDesign",
): ImplementationLink {
  return { kind: "IMPLEMENTS", sourceId, sourceKind, targetId, targetKind }
}
