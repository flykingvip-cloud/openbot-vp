# Data minimization contract — Checkpoint B (freeze cycle 2)

assessedAt: 2026-09-28T20:05:00+08:00
Applies to: future Candidate A deps, observe projection and observability sink
Status: design contract only (not implemented this checkpoint)
Cycle 2: Security S1 (no environment values in deps) and S3 (profile category fixed to `unspecified`) tighten the cycle-1 whitelist.

## 1. First-slice whitelist (ONLY these may cross the observe / sink boundary)

| Category                  | Allowed values                                                                                              | Notes                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Fixed code enums          | `mode: "inert" \| "shadow"`; `decisionStage` from a **closed code enum** declared in the projection module  | Closed sets only; no free-form strings                                                   |
| Fixed reason codes        | `none`, `flag_off`, `shadow_inert`, `observe_error`, `gate_skipped` (exact closed set in projection module) | No free-text reasons; no user content                                                    |
| Booleans                  | `invoked`, `blocked`, `executed`, `wroteReceipt`, `wroteTrace`, `flagOn`, `pathExists`, `gapExists`         | Hard-false fields stay false in reports                                                  |
| Fixed profile category    | `unspecified` **only** in the first slice (literal set by the projection module)                            | Not derived from any input; `personal_local` / `managed_enterprise` are not emitted (§5) |
| Fixed capability category | Closed enum declared in projection module (no capability values / policy table bodies)                      | No allow-list contents                                                                   |
| Bounded latency bucket    | Closed bucket labels only, e.g. `le_1ms`, `le_2ms`, `le_5ms`, `gt_5ms`                                      | **Not** raw millisecond integers as correlatable signals across requests; bucket only    |

Removed from the first-slice whitelist (explicit):

- Vague “stable irreversible category IDs” / hashed path-category tokens
- Raw `observeLatencyMs` integers as cross-request correlators (use buckets)
- Any dynamic string not in a fixed enum / reason-code set
- Profile A / Profile B category values (cycle 2, S3)

## 2. Ban list (MUST NOT cross)

- Raw user text / prompts / utterances / message bodies
- URLs (any scheme)
- PII (names, emails, phone, handles)
- Identity identifiers (`userId`, `seatId`, `membershipId`, `sessionKey`, `conversationId`, `requesterId`) as observe payload
- **User / tenant / session hashes** (including irreversible hashes of those identifiers)
- **Request ID, trace ID, URL hashes**, or any **correlatable cross-request IDs**
- **Any dynamic strings** not drawn from a fixed closed enum / reason-code set
- Tenant secrets / API keys / tokens / credentials
- **Environment variable names or values** other than the parsed `runtimeShadowEnabled` boolean (cycle 2, S1)
- Cross-profile projection (must not merge Profile A with Profile B views)
- A profile category derived from any input (cycle 2, S3)
- Tool arguments / tool results / file bodies
- Full `ValidationReceipt` or `ExecutionTraceRecord` objects
- Full proofs, ledger rows, governance decision envelopes with actor ids
- Artifact paths / workspace absolute paths
- `candidatePath` / `workflowRef` raw strings into sink

## 3. Projection rule

Future `constitutional-runtime-shadow-projection.ts` MUST build a new object from whitelist fields only. It MUST NOT pass through `validationReceipts` / `executionTraces` arrays from preflight types unchanged.

If a field is not on the whitelist, it is omitted. There is no "redact later" path for banned fields. Dynamic identifiers MUST NOT reach projection, sink, logs, or metrics (planned test B-25).

The projection sets `profileCategory: "unspecified"` as a literal and reads no input to decide it (B-34, B-35).

## 4. Cardinality lock (first slice)

Recount and lock with tests (test-plan B-15, B-21..B-28, B-34, observability contract):

| Dimension                       | Bound                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Metric label combinations       | `surface`(1) × `result_mode`(2) × `error_class`(2: `none`\|`throw`) × `flag_runtime`(2) = **≤ 8**      |
| Projection reason codes         | **≤ 5** fixed codes listed in §1                                                                       |
| Sink error codes                | **1** (`observe_error`)                                                                                |
| Profile category values         | **1** (`unspecified`) in the first slice                                                               |
| Latency buckets                 | **≤ 4**                                                                                                |
| Capability category values      | Closed enum size locked in projection module + unit test (must be finite and reviewed; no open string) |
| Max distinct projection key set | Exact key allow-list asserted by unit test                                                             |
| Deps own keys                   | **3** (`runtimeShadowEnabled`, `sink`, `now`)                                                          |

Prior “≤ 32 label combinations”, “stable irreversible category IDs” and “profile category ≤ 3” language is superseded by this recount.

## 5. Profile / tenant (Security S3)

- First slice: `profileCategory` is always the literal `unspecified`.
- The first slice adds no Profile resolution dependency. At the verification baseline the Candidate A chain (`run.ts`, `attempt.ts`) holds no authoritative resolved profile (`resolveSecurityProfile` / `SecurityProfile` do not appear there).
- `profileCategory` is never derived from: prompts; model output; tool args or results; headers; ordinary request fields; `sessionKey`; tenant hints; caller env maps; the Constitutional observation result.
- The first slice never emits or synthesizes Profile A or Profile B.
- `tenantId` and tenant/user/session hashes MUST NOT appear in observe payloads or sinks for this slice.
- No synthetic tenant for Profile A; no cross-profile join.
- A real Profile A/B category requires a separate design task that names the authoritative source, the tenant boundary, the Profile resolution point in time, any new paths, and a Security re-review.

## 6. Relation to existing façade input types

Today `observePreflightRuntimeFacade` accepts `validationReceipts` / `executionTraces`. Checkpoint C MUST either:

1. Feed only a minimized `sources` / view built by the projection module, or
2. Narrow the call so banned fields never enter.

Passing full receipts "because the type allows it" is a contract violation.

## 7. Deps minimization (Security S1)

- `ConstitutionalRuntimeShadowDeps` carries exactly `runtimeShadowEnabled: boolean`, `sink` and `now`, frozen.
- No `process.env` object, environment copy or environment map may appear in deps, in `EmbeddedRunAttemptParams`, or in any shadow module.
- Unrelated environment keys (including secrets such as API keys and tokens) are never read for this feature and never reach deps, projection, sink, logs or metrics (B-29, B-30).
- The raw flag string is parsed in `run.ts` and discarded; only the boolean crosses into the attempt.
