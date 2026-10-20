# @openbot/aor-sdk-node

Node SDK + CLI for the **Agent Orchestration Runtime (AOR)**.

Describe a task; AOR parses it, selects a model, executes it on OpenBot, and
evaluates the result.

## SDK

```ts
import { createDefaultClient } from "@openbot/aor-sdk-node";

const client = createDefaultClient({ baseUrl: "http://127.0.0.1:18789" });
const agent = client.agent({
  goal: "analyze this codebase and suggest improvements",
  constraints: { budgetUsd: 0.5, latency: "medium" },
});
const result = await agent.run({ strategy: "best_quality" });
console.log(result.selection.model, result.evaluation?.score);
```

## CLI

```bash
# Offline demo (stub backend, no gateway required)
aor "review this codebase and suggest improvements" --strategy best_quality --dry-run

# Against a running OpenBot gateway
aor "summarize this article" --strategy cheapest --base-url http://127.0.0.1:18789
```

## Verifiable probes

`createCommandProbe` / `createCoverageProbe` provide objective build/test/coverage
signals for the Evaluator (the runner is injectable so unit tests never shell out).
