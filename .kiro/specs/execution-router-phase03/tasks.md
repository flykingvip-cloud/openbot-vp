# execution-router-phase03

Phase 0.3: real-model operational performance evidence. Observation-only.
No Skill/Tool Top-K. No AOR DAG. No ConversationTask activation.
No `ORCHESTRATION_LIVE_INVOKE`. Do not modify Phase 0.2a files.

## Agents

- cursor-grok · role: owner · scope: execution-router-phase03 · paths: .kiro/specs/execution-router-phase03/\*\* · since: 2026-09-07

## Tasks

- [x] Isolated worktree from `origin/main` `af0e5bf9b2` (#1006). — cursor-grok
- [x] Loom register `execution-router-phase03:cursor-grok`. — cursor-grok
- [x] Checkpoint P1: performance contract, collector, validator, unit tests. — cursor-grok
- [ ] Checkpoint P2: isolated gateway, ≥20 real-model samples, privacy audit.
- [ ] Checkpoint P3: report, independent recompute, Phase 1 Shadow Router entry.

P2 stays blocked until P1 is green, #1006 is on `origin/main`, an isolated
gateway is available, and live model credentials/quota exist. Do not invent
operational samples.
