# Diagnosis INCIDENT mode — design authority + reverse coverage

- Finding baseline commit: `e7c614eb54214b2f62f082c8d99dca08b8c58232`
- Worktree tip at decision: `origin/main` (contains `e7c614eb` and `#944` / `da5214037a`)
- Date: 2026-09-04 (Asia/Shanghai)

## Decision

**Case B — reserved / unsupported (explicit rejection; no silent QUICK equivalence).**

INCIDENT remains a **protocol token** in `DIAGNOSTIC_RUN_MODES` / `DiagnosticRun.mode` (forward-compatible with Phase 3), but **planner and runner must reject** it. Mapping INCIDENT → QUICK via an `else` branch is a DEFINITION_FORK and is forbidden.

Not Case A: specs do **not** define formal INCIDENT planner steps, evidence budget, stopWhen, or completion semantics.
Not Case C: no authority equates INCIDENT to QUICK, TARGETED, or FULL.

## Authority sources (paths + quotes)

1. `docs/design/openbot-diagnosis-platform-implementation-plan-2026-09-02.md` §4.2 DiagnosticRun type lists the token:

   > `mode: "QUICK" | "TARGETED" | "FULL" | "INCIDENT";`

2. Same plan §14.1 / §15 Phase 1 deliverables — only QUICK and TARGETED in Phase 1:

   > `- QUICK 和 TARGETED 模式。` / `- \`QUICK\`、\`TARGETED\` Run。`

3. Same plan §14.2 Phase 1 exclusions:

   > `- FULL 平台巡检和跨租户 Incident 自动编排。`

4. Same plan §15 Phase 3 (future formal delivery):

   > `### Phase 3：FULL、INCIDENT 与高级 Planner，3–4 周`  
   > `- FULL 与 INCIDENT 模式。`

5. `docs/design/openbot-diagnosis-phase1-vertical-slice-2026-09-02.md` §2 table:

   > `| 一期禁止       | FULL / INCIDENT、高风险 Probe、Remediation execute                   | 同左                                                                         |`

6. Same vertical-slice §7:

   > `- \`FULL\` / \`INCIDENT\` 模式、跨租户编排、独立 Diagnosis 微服务。`

7. Code comments (pre-fix):
   - `src/diagnosis/planner.ts`: `Evidence Planner — QUICK / TARGETED for the vertical slice.` / `FULL appends Phase 2…` — PlannerInput typed as `Extract<DiagnosticRunMode, "QUICK" | "TARGETED" | "FULL">` (INCIDENT excluded at type level only).
   - `src/diagnosis/runner.ts`: `mode: seed.mode === "FULL" ? "FULL" : seed.mode === "TARGETED" ? "TARGETED" : "QUICK"` — **silent else → QUICK** (the fork under fix).
   - `src/diagnosis/types.ts`: `DIAGNOSTIC_RUN_MODES = ["QUICK", "TARGETED", "FULL", "INCIDENT"]` — protocol accepts the token.

## Rationale

- Protocol union includes INCIDENT for forward compatibility with Phase 3 naming.
- No design doc defines INCIDENT planner/evidence/stop/completion behavior; inventing a full INCIDENT product would exceed authority.
- Prefer fail-closed reserved rejection over inventing Case A semantics or Case C equivalence.
- Silent QUICK fallback hides caller intent and violates phase gates (Phase 1 forbids INCIDENT; Phase 3 has not shipped).

---

## Step 1 — Reverse coverage (pre-fix)

### A) Constructors / receivers of `DiagnosticRun.mode`

| Surface            | Path / symbol                                            | Modes observed                                                                                   | Notes                                                   |
| ------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Protocol const     | `src/diagnosis/types.ts` `DIAGNOSTIC_RUN_MODES`          | QUICK\|TARGETED\|FULL\|INCIDENT                                                                  | Token reserved                                          |
| Validator          | `validateDiagnosticRun`                                  | accepts all four via `requireLiteral(..., DIAGNOSTIC_RUN_MODES)`                                 | INCIDENT **accepted**                                   |
| Plan validator     | `validateDiagnosisPlan`                                  | same four                                                                                        | Would accept an INCIDENT plan object if constructed     |
| Diagnoser manifest | `validateDiagnoserManifest` `modes`                      | same four                                                                                        | Catalog typing only                                     |
| Planner            | `buildDiagnosisPlan` / `PlannerInput.mode`               | QUICK\|TARGETED\|FULL only (Extract)                                                             | Compile-time exclude; no runtime INCIDENT guard pre-fix |
| Runner             | `replayDiagnosticRunGraph`                               | maps FULL→FULL, TARGETED→TARGETED, **else→QUICK**                                                | INCIDENT / unknown → QUICK (bug)                        |
| Public API         | `diagnose` / `diagnoseFromContext`                       | passes `run` into runner                                                                         | Inherits runner mapping                                 |
| Fixtures           | `src/diagnosis/fixtures/*.json`                          | QUICK×5, TARGETED×1                                                                              | No INCIDENT fixture                                     |
| Unit constructors  | `types.test.ts` `validRun`, phase1/phase2/registry tests | QUICK / TARGETED / FULL                                                                          | No INCIDENT production of mode                          |
| Gateway / CLI      | `src/gateway`, `src/cli`, `src/commands`                 | **no** `validateDiagnosticRun` / `buildDiagnosisPlan` / `replayDiagnosticRunGraph` callers found | No dedicated HTTP/CLI mode picker on this tip           |

**Is INCIDENT production-reachable to `validateDiagnosticRun`?**  
Yes, if any in-process caller builds a `DiagnosticRun` with `mode: "INCIDENT"` (e.g. `diagnose({ run })`). There is **no** dedicated Gateway/CLI entry that emits INCIDENT on this tip. Reachability to the silent QUICK path is via `diagnose` → `replayDiagnosticRunGraph`.

### B) `validateDiagnosticRun(INCIDENT)` behavior (pre-fix)

Accepts: `mode` is a member of `DIAGNOSTIC_RUN_MODES`. No phase gate. Returns a typed `DiagnosticRun` with `mode: "INCIDENT"`.

### C) `buildDiagnosisPlan` path for INCIDENT (pre-fix)

TypeScript rejects `mode: "INCIDENT"` on `PlannerInput` (`Extract` omits it). Runtime: if a string `"INCIDENT"` were forced, the planner ternary treats non-QUICK non-FULL as TARGETED (`else buildTargetedSteps`) — a second silent fork distinct from the runner’s QUICK fallback. Callers normally only reach planner through the runner’s coerce-to-QUICK/TARGETED/FULL.

### D) `replayDiagnosticRunGraph` / runner mapping (pre-fix)

| `seed.mode`                             | Mapped planner mode |
| --------------------------------------- | ------------------- |
| QUICK                                   | QUICK               |
| TARGETED                                | TARGETED            |
| FULL                                    | FULL                |
| INCIDENT                                | **QUICK (silent)**  |
| (any other string surviving validation) | **QUICK (silent)**  |

Journal still records `detail: seed.mode` (original), while `plan.mode` becomes QUICK — fork is observable as plan/journal mismatch.

### E) Existing test gaps (pre-fix)

- No test asserts INCIDENT is rejected by planner or runner.
- No test locks “INCIDENT must not become QUICK”.
- `phase1-runtime.test.ts` asserts `plan.mode === TARGETED ? TARGETED : QUICK` over fixtures only (QUICK/TARGETED) — does not cover FULL or INCIDENT.
- `types.test.ts` does not assert INCIDENT acceptance-as-reserved vs execution rejection.
- Phase2 tests cover FULL planner scheduling only.

---

## Fix summary (Case B)

- Add `assertSupportedPlannerRunMode` — QUICK|TARGETED|FULL pass; INCIDENT throws (reserved/unsupported; no silent fallback).
- Runner uses that assert instead of `else → QUICK`.
- Planner defense-in-depth: reject unsupported modes at `buildDiagnosisPlan` entry if ever called with a widened mode.
- Keep `DIAGNOSTIC_RUN_MODES` including INCIDENT (protocol reserved token).
- Regression tests: INCIDENT must not become QUICK; replay/planner throw; validate still accepts token.

## Negative space

- No INCIDENT planner/product semantics invented.
- No Diagnoser registry / D1 / Phase1–2 redesign / stopWhen rewrite / evidence adapter rewrite.
- No remediation enablement; no `doctor_fix` / `repair` / `restart_gateway` / `startChannel` / `stopChannel`.
- Not claiming Truename CLOSED.
