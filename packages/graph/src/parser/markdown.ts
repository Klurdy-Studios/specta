import type {
  ParsedHeading,
  ParsedSpecification,
  ParsedSpecificationEntity,
  SourceLocation,
  SpecificationEntityKind,
} from "@specta/core"
import type { ParserInput, SpecificationParser } from "./contracts.ts"

const headingPattern = /^(#{1,6})\s+(.+?)\s*$/
const listItemPattern = /^\s*(?:[-*+] |\d+[.)] )(?:\[[ xX]\]\s*)?(.+?)\s*$/

/** Deterministic Markdown parser for Specta planning and architecture documents. */
export const markdownSpecificationParser: SpecificationParser = {
  extensions: [".md"],
  parse(input): ParsedSpecification {
    const lines = input.content.split(/\r?\n/)
    const headings: ParsedHeading[] = []
    const entities: ParsedSpecificationEntity[] = []
    let activeSection: SpecificationEntityKind | undefined
    let activeEpic: string | undefined
    let activeStory: string | undefined

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? ""
      const headingMatch = headingPattern.exec(line)
      if (headingMatch) {
        const hashes = headingMatch[1]
        const rawTitle = headingMatch[2]
        if (!hashes || !rawTitle) continue
        const heading = {
          depth: hashes.length,
          title: rawTitle.trim(),
          location: lineLocation(input.path, index, line),
        }
        headings.push(heading)
        const explicit = classifyHeading(heading.title)
        if (explicit) {
          const parentTitle = explicit.kind === "story" ? activeEpic
            : explicit.kind === "task" || explicit.kind === "acceptance-criterion" ? activeStory
            : undefined
          entities.push(entity(explicit.kind, explicit.title, heading.location, parentTitle))
          if (explicit.kind === "epic") {
            activeEpic = explicit.title
            activeStory = undefined
          } else if (explicit.kind === "story") {
            activeStory = explicit.title
          }
          activeSection = undefined
        } else {
          activeSection = classifySection(heading.title)
        }
        continue
      }

      const itemMatch = listItemPattern.exec(line)
      const itemTitle = itemMatch?.[1]?.trim()
      if (!itemTitle || !activeSection) continue
      const parentTitle = activeSection === "story" ? activeEpic
        : activeSection === "task" || activeSection === "acceptance-criterion" ? activeStory
        : undefined
      entities.push(entity(activeSection, itemTitle, lineLocation(input.path, index, line), parentTitle))
    }

    const value: ParsedSpecification = {
      path: input.path,
      headings,
      entities,
      diagnostics: [],
    }
    const title = headings.find((heading) => heading.depth === 1)?.title
    if (title) value.title = title
    return value
  },
}

function classifyHeading(title: string): { kind: SpecificationEntityKind; title: string } | undefined {
  const match = /^(epic|story|task|acceptance criterion)\s*(?:\d+(?:\.\d+)*)?\s*[:\-–—]\s*(.+)$/i.exec(title)
  if (!match?.[1] || !match[2]) return undefined
  const kinds: Record<string, SpecificationEntityKind> = {
    epic: "epic",
    story: "story",
    task: "task",
    "acceptance criterion": "acceptance-criterion",
  }
  const kind = kinds[match[1].toLowerCase()]
  return kind ? { kind, title: match[2].trim() } : undefined
}

function classifySection(title: string): SpecificationEntityKind | undefined {
  const normalized = title.toLowerCase().replace(/[^a-z]+/g, " ").trim()
  if (/^(requirements?|functional requirements?|non functional requirements?)$/.test(normalized)) return "requirement"
  if (/^(architecture decisions?|decisions?)$/.test(normalized)) return "architecture-decision"
  if (/^(epics?)$/.test(normalized)) return "epic"
  if (/^(stories|user stories)$/.test(normalized)) return "story"
  if (/^(acceptance criteria|acceptance criterion)$/.test(normalized)) return "acceptance-criterion"
  if (/^(tasks?|implementation tasks?)$/.test(normalized)) return "task"
  return undefined
}

function entity(
  kind: SpecificationEntityKind,
  title: string,
  location: SourceLocation,
  parentTitle?: string,
): ParsedSpecificationEntity {
  return parentTitle ? { kind, title, parentTitle, location } : { kind, title, location }
}

function lineLocation(path: string, index: number, line: string): SourceLocation {
  return {
    path,
    start: { line: index + 1, column: 0 },
    end: { line: index + 1, column: line.length },
  }
}
