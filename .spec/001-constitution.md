# Specta Constitution

## Core Philosophy

Every feature must improve one of:

- Planning
- Context
- Validation
- Traceability

If it does not, it should not exist.

---

## Architecture

Core contains no AI.

Core must be deterministic.

Core must be language independent.

Adapters implement language support.

Interfaces (CLI, MCP, SDK and editor integrations) remain thin.

Workflow orchestration is agent-agnostic. Agent-specific communication belongs in
adapters, never in Core or the Workflow Engine.

---

## AI

AI is used only for reasoning.

Algorithms determine:

- dependency traversal
- graph construction
- token optimization
- validation
- context selection

---

## Performance

Minimize tokens.

Minimize latency.

Minimize unnecessary edits.

Prefer minimal patches.

---

## Specifications

Every implementation traces back to:

Epic

↓

Story

↓

Acceptance Criteria

↓

Files

↓

Tests

---

## Context

Never send an entire repository.

Always compile the smallest sufficient context.

Context compilation must be explainable.

---

## Validation

Every generated implementation must satisfy:

Architecture

Requirements

Acceptance Criteria

Tests

Security Rules

Coding Standards

---

## Extensibility

Language support exists as plugins.

Planning exists as plugins.

Validators exist as plugins.

Models remain interchangeable.

Prompt templates describe reusable workflows rather than agent-specific prompts.

---

## User Experience

Developers should never need to understand the graph.

Specta should feel like:

"AI simply understands my project."

Complexity belongs inside Specta.

Not in user workflows.
