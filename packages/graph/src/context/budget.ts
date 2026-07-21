/** One internal optional item considered by deterministic ranking and budgeting. */
export interface ContextCandidate<T> {
  key: string
  score: number
  value: T
}

/** Deterministic dependency-free approximation suitable for relative context budgets. */
export function estimateContextTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  return text.length === 0 ? 0 : Math.ceil(text.length / 4)
}

/** Keeps the highest-ranked optional items that fit after required context. */
export function selectContextCandidates<T>(
  candidates: ContextCandidate<T>[],
  requiredTokens: number,
  maxTokens: number,
): ContextCandidate<T>[] {
  let used = requiredTokens
  const selected: ContextCandidate<T>[] = []
  for (const candidate of rankContextCandidates(candidates)) {
    const cost = estimateContextTokens(candidate.value)
    if (used + cost > maxTokens) continue
    selected.push(candidate)
    used += cost
  }
  return selected
}

function rankContextCandidates<T>(candidates: ContextCandidate<T>[]): ContextCandidate<T>[] {
  const bestByKey = new Map<string, ContextCandidate<T>>()
  for (const candidate of candidates) {
    const current = bestByKey.get(candidate.key)
    if (!current || candidate.score > current.score) bestByKey.set(candidate.key, candidate)
  }
  return [...bestByKey.values()].sort((left, right) =>
    right.score - left.score || left.key.localeCompare(right.key),
  )
}
