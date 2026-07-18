import type { Architecture, Constitution, Epic, Roadmap, Vision } from "@specta/core"

export function renderVision(vision: Vision): string {
  return [
    "# Vision",
    "",
    "## " + vision.title,
    "",
    "## Problem",
    "",
    vision.problem,
    "",
    "## Audience",
    "",
    vision.audience,
    "",
    "## Outcome",
    "",
    vision.outcome,
    "",
  ].join("\n")
}

export function renderConstitution(constitution: Constitution): string {
  return ["# Constitution", "", "## Principles", "", ...constitution.principles.map((principle) => "- " + principle), ""].join("\n")
}

export function renderArchitecture(architecture: Architecture): string {
  return [
    "# Architecture",
    "",
    architecture.overview,
    ...(architecture.guidance ? ["", "## User Guidance", "", architecture.guidance] : []),
    "",
    "## Components",
    "",
    ...architecture.components.map((component) => "- " + component),
    "",
  ].join("\n")
}

export function renderRoadmap(roadmap: Roadmap): string {
  const lines = ["# Roadmap", ""]
  for (const [index, milestone] of roadmap.milestones.entries()) {
    lines.push(
      "## " + String(index + 1) + ". " + milestone.title,
      "",
      "**Objective:** " + milestone.objective,
      "",
      "### Outcomes",
      "",
      ...milestone.outcomes.map((outcome) => "- " + outcome),
      "",
    )
  }
  return lines.join("\n")
}

export function renderEpic(epic: Epic): string {
  const lines = ["# Epic — " + epic.title, "", "## Goal", "", epic.goal, ""]
  for (const story of epic.stories) {
    lines.push("## Story — " + story.title, "", story.description, "", "### Acceptance Criteria", "")
    lines.push(...story.acceptanceCriteria.map((criterion) => "- " + criterion), "", "### Tasks", "")
    lines.push(...story.tasks.map((task) => "- [ ] " + task.title + " — " + task.description), "")
  }
  return lines.join("\n")
}
