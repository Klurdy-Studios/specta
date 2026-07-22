# Specta implement workflow

Implement exactly one eligible Epic through the active coding-agent session.

1. Invoke `implement <epic-id|next> --prepare --json` through the configured Specta CLI command.
2. Treat the returned persisted Context Packet as the implementation scope. Read additional source only when a packet path or dependency requires it.
3. Implement production code and executable tests using the coding agent's reasoning. Specta does not generate business logic.
4. Map every acceptance criterion to one or more exact test paths, and test names when available, in validation evidence JSON.
5. When the coding-agent runtime exposes cumulative token telemetry, record input, cached input, output, reasoning, and total tokens. Never invent measured values.
6. Invoke `implement <implementation-run-id> --finalize --evidence <evidence.json> --json`. Add `--token-usage <token-usage.json>` only when telemetry is available.
7. If validation fails, fix the reported findings and finalize the same run again with updated cumulative token telemetry.
8. Finish by reporting validation status, implementation relationships, and the complete token breakdown returned by Specta.

Token usage JSON has this exact shape:

```json
{
  "source": "measured",
  "inputTokens": 1200,
  "cachedInputTokens": 400,
  "outputTokens": 300,
  "reasoningTokens": 100,
  "totalTokens": 1500
}
```

Use `source: "measured"` for runtime telemetry and `source: "reported"` only when the coding-agent host reports the counters without identifying them as measured. `totalTokens` must equal input plus output. Cached tokens are part of input; reasoning tokens are part of output. When telemetry is unavailable, omit the file and Specta will explicitly report that limitation without blocking finalization.
