# Phase 0 shadow correction

Signed: Agent `cursor-grok` · Task `execution-router-phase0` · 2026-09-06

This note corrects the operational status recorded after #1002. It does not
delete `.kiro/specs/execution-router-phase0/phase0-shadow-report.md` and does
not rewrite historical commits.

## Correction

The 60 rows in `phase0-shadow-report.md` are **fixture/component shadow
samples**. They drove production `observe*` / `measure*` helpers with
sanitized fixtures. They did **not** enter:

`chat request → dispatch/get-reply → runEmbeddedAttempt → activeSession.prompt → terminal lifecycle sink`

| Gate                               | Status                                             |
| ---------------------------------- | -------------------------------------------------- |
| fixture observation gate           | accepted (60 fixture/component samples; privacy 0) |
| operational end-to-end shadow gate | pending (this round)                               |

## Why

Fixture rows can prove count formulas, first-write-wins, and privacy filters.
They cannot prove that the live attempt marks stages only after the real
allowlist, hook/context assembly, and `session.prompt`.

## Follow-up in this commit

- Reproducible collector + validator under `shadow/`
- Sanitized summary JSON + SHA-256
- Phase 0.1 contract extension plan (ID/digest fields; no Top-K)
- In-process E2E harness that calls `runEmbeddedAttempt` and
  `activeSession.prompt`, then `emitChatInboundStage` (the production inbound
  emitter used by get-reply / agent-runner)

No Skill Top-K. No Tool Top-K. No DAG. No `ORCHESTRATION_LIVE_INVOKE`.

## Gate split (later the same day)

Do not treat harness calculations as a production baseline.

| Gate                                  | Status   |
| ------------------------------------- | -------- |
| fixture/component gate                | accepted |
| runEmbeddedAttempt integration gate   | accepted |
| main-chain wiring E2E                 | accepted |
| real operational performance baseline | pending  |
| Phase 1 entry                         | blocked  |

Current sidecar numbers (`required-skill recall=1`, `TTFT=15`, `promptTokens=12`, `first-tool success=1`) are **harness calculation values**. They are not a real operational performance baseline.
