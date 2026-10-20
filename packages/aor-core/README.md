# @openbot/aor-core

Backend-agnostic core of the **Agent Orchestration Runtime (AOR)**.

It contains the task taxonomy, capability registry, model selection, evaluation,
feedback, and the `ExecutionBackend` abstraction. It has **zero runtime
dependencies** and imports **no OpenBot internals** — OpenBot (or any other
engine) is reached only through an `ExecutionBackend` implementation.

## Pipeline (Stage 1)

```
Task -> TaskParser -> (TaskType) -> CapabilityRegistry -> Selector
     -> ExecutionBackend -> Evaluator -> FeedbackStore
```

## Key exports

- `ExecutionBackend` — the single coupling point to an execution engine.
- `TaskTypeRegistry`, `createBuiltinTaskTypeRegistry()` — the task taxonomy.
- `CapabilityRegistry`, `Skill`, `PromptSkill` — tasks route to capabilities.
- `selectModel()` — cost / quality / latency aware model selection.
- `VerifiableEvaluator`, `EvalProbe` — objective task-completion scoring.
- `EmaFeedbackStore` — turns evaluation scores into learned model quality.
- `Orchestrator` — wires the pipeline end to end.

See `docs/design/aor-agent-orchestration-runtime-plan-2026-06-04.md` for the
full design.
