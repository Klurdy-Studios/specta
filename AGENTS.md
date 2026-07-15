# Specta Development Guide

## Mission

Specta is an AI software engineering platform that transforms project specifications and source code into a structured Workspace Graph.

## Principles

- The Workspace Graph is the source of truth.
- Prefer deterministic algorithms over LLM reasoning.
- Keep packages focused and loosely coupled.
- Avoid unnecessary abstractions.
- Public APIs must be documented.
- Every feature must improve planning, context quality, validation, or token efficiency.

## Tech Stack

- TypeScript
- pnpm workspaces
- Vitest
- ESLint
- Biome (or Prettier, if you choose)