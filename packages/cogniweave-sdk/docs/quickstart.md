# Quickstart

This quickstart shows the smallest useful integration path for CogniWeave.

## 1. Create an Engine

```ts
import { InMemoryCogniWeaveEngine } from "@cogniweave/sdk";

const engine = new InMemoryCogniWeaveEngine({
  environment: "local",
  metadataBackend: "memory",
  graphBackend: "memory",
  evidenceBackend: "memory",
  vectorBackend: "memory",
});
```

Optional: enable HTTP-backed LLM task framing fallback.

```ts
const engine = new InMemoryCogniWeaveEngine({
  environment: "local",
  metadataBackend: "memory",
  graphBackend: "memory",
  evidenceBackend: "memory",
  vectorBackend: "memory",
  enableLlmTaskFraming: true,
  llmTaskFramingEndpoint: "https://your-llm-gateway.example.com/frame-task",
  llmTaskFramingApiKey: process.env.COGNIWEAVE_LLM_API_KEY,
  llmTaskFramingModel: "gpt-5.4-mini",
  enableLlmDistillation: true,
  llmDistillationEndpoint: "https://your-llm-gateway.example.com/distill",
  llmDistillationApiKey: process.env.COGNIWEAVE_LLM_API_KEY,
  llmDistillationModel: "gpt-5.4-mini",
  llmDistillationProfile: "multi_call", // "single_call" | "multi_call"
  llmDistillationStages: ["event", "context", "atoms", "relations"],
  llmRequestTimeoutMs: 3000,
});
```

## 1b. Start the CLI Service

```bash
pnpm --dir packages/cogniweave-sdk exec cogniweave serve --metadata-backend memory --graph-backend memory --vector-backend memory
```

Use `--bootstrap-schemas` when the selected adapters expose schema bootstrap support.
Use `--print-config` to inspect the resolved runtime config without opening a socket.
Use `--dry-run` to validate the serve path without binding a network port.
Use `--json` when you want script-friendly output.
Use `--output <file>` to persist the output payload for CI artifacts.

## 2. Define Scope

```ts
const scope = {
  workspaceId: "ws_1",
  projectId: "proj_1",
  agentId: "agent_main",
  visibility: "private" as const,
};
```

## 3. Frame a Task

```ts
const task = await engine.frameTask(
  "Current throughput is dropping and the external API is slow. Should we add synchronous retries?",
  { scope },
);
```

## 4. Reason

```ts
const pkg = await engine.reason(task);

console.log(pkg.answer.summary);
console.log(pkg.why.summary);
```

## 5. Write Back

```ts
const writeResult = await engine.writeBack({
  rawInput:
    "Current throughput is dropping and the external API is slow. Should we add synchronous retries?",
  scope,
  sourceType: "chat",
  sourceSessionId: "sess_001",
  package: pkg,
});

console.log(writeResult.status);
console.log(writeResult.journalId);
```

## 6. Trace

```ts
const trace = await engine.tracePackage(pkg.packageId, { scope });
console.log(trace.selectedTemplate);
console.log(trace.selectedPathIds);
```

## Expected Behavior

- `frameTask()` always returns a valid `TaskFrame`
- `reason()` returns a `CognitivePackage`
- `writeBack()` distinguishes canonical success from derived sync success
- `tracePackage()` exposes the chosen reasoning path

## Next Steps

- use `reasonWithDebug()` during development
- use `distill()` for offline memory building
- use `repairIndexes()` when a write returns `DERIVED_OUT_OF_SYNC`
