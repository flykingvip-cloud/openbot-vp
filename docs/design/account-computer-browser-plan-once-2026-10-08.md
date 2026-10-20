# Account Computer — Browser plan-once + legal DOM action space + NEEDS_*

Landing: `BROWSER_PLAN_ONCE_LEGAL_DOM_M1`  
Date: 2026-10-08 (rev 2026-10-09: replan/terminal table + Shape B budgets)  
Status: design only (no runtime code in this tip)  
Inspiration: [third-hand](https://github.com/shhivv/third-hand) + [arc-cua](https://github.com/shhivv/arc-cua) (transfer loop contracts; **do not** port macOS Accessibility)

## Problem

1. **Cost / latency (M3):** Account Computer browser work often re-invokes a frontier model after every click. third-hand / arc-cua show a cheaper split: plan a bounded step list once, execute with a thin grounding layer, replan only on failure.
2. **Hallucinated targets:** Agents invent selectors, coordinates, or labels that are not in the current page. Clicks miss; recovery burns more tokens; users see thrashing on the 电脑 preview.
3. **False finals (M2):** Runs sometimes emit `chat.final` / “done” while the page is mid-load, behind a login wall, or waiting for user input (扫码 / 密码). We already ban premature plan-speak; we lack a **typed terminal vocabulary** the executor and UI share.
4. **Settle gaps:** Acting before DOM/network quiet produces flaky verify and duplicate actions (same button thrice).

This is **not** a new desktop product. It is a **Browser subtask loop** that plugs into the existing shared Chromium + noVNC Account Computer, ownership, and input grants.

## Non-goals (this tip)

- macOS AX / OCR-as-primary / Control–Space / local Keychain ChatGPT
- Replacing noVNC preview, Ownership coordinator, or Input capability (#438/#439/#469)
- Implementing the runtime in this landing (design + registry only)
- Auto-pay / submitting payment passwords (iron ban unchanged)
- Multi-session greenfield browsers (stay on #423 shared browser)

## Iron rules unchanged

- `streamUrl ≠ FIRST_FRAME ≠ INTERACTIVE`
- No `location.reload` as recovery
- 不确定 → pause / 接管；禁止用计划腔当 final
- 扫码硬规则；不代付
- Right-dock 电脑 Tab; takeover remint input grant

## Proposed architecture

```
chat / robot planner (frontier)
        │  one Subtask or act(steps[])
        ▼
┌───────────────────────────────────────┐
│  Browser Plan-Once Action Layer       │
│  1. observe(CDP/a11y → LegalSpace)    │
│  2. ground(step → elementId ∈ space)  │
│  3. execute via existing browser tools│
│  4. settle (network+DOM quiet)        │
│  5. verify → continue | replan | NEEDS_* │
└───────────────────────────────────────┘
        │
        ▼
Account Computer Chromium (shared) + sessionStreams
+ Ownership / input grant gates (unchanged)
+ optional siteHost skill hints (M4)
```

**Planner owns intent** (goal, literal `inputs`, verification criteria, risk allowances).  
**Action layer owns grounding + settle + verify.** It never invents text that is not in `inputs`.  
**UI owns pause surfaces** when status is `NEEDS_INPUT` / `NEEDS_AGENT` / `BLOCKED`.

Hypothesis for plug-in points (verify in impl tip against current tree): browser tool / CDP observe path under Account Worker sandbox browser; chat execution loop that today calls tools turn-by-turn; computer preview pause / 接管 affordances already used by M2.

## Subtask / plan shapes

### Shared budgets (A and B)

Both shapes use the **same** counters on the action-layer run:

| Field | Default | Meaning |
|---|---|---|
| `max_actions` | `20` | Cap on grounded execute calls (click/type/press/scroll count; `wait` may count or not — impl must pick one and stick; recommend **counting** wait toward the budget) |
| `max_replans` | `2` | Cap on **frontier** replans after the initial plan. Exhausted → `BLOCKED` (or `FAIL` if the planner previously declared the task impossible). **No unbounded frontier replan** (M3 plan-once). |

Optional later (not M1): one **cheap** (non-frontier) disambiguation call per grounding miss — does **not** consume `max_replans`.

### A. Structured subtask (arc-cua-like)

```json
{
  "goal": "Open the product page and stop at confirmation (do not pay)",
  "inputs": { "query": "特步 160 X7.0pro 39" },
  "verification": [
    "A product detail or cart confirmation screen is visible",
    "No payment-password dialog was submitted"
  ],
  "constraints": ["Do not click 立即支付 / submit pay", "Prefer 扫码 if asked to pay"],
  "max_actions": 20,
  "max_replans": 2,
  "allowed_risks": [],
  "secret_inputs": []
}
```

### B. Explicit step plan (third-hand-like)

Planner calls `act` once with:

- `finishes_task: boolean`
- `summary: string`
- `max_actions: number` (default 20; same as A)
- `max_replans: number` (default 2; same as A)
- `steps[]` each `{ action: click|type|press|scroll|wait, target?, role?, near?, text?, key?, direction? }`

Action vocabulary (M1):

| `action` | Needs snapshot `id`? | Notes |
|---|---|---|
| `click` | **Yes** | Ground `target`/`role`/`near` → id |
| `type` | **Yes** | Field id; `text` from planner or `inputs` only |
| `press` | **No** (global key) | Keyboard chord only (`key` + modifiers). Prefer this name; do **not** use `press-on-element` |
| `scroll` | **No** | Optional `target` as scroll container label; if provided and matchable, ground it; else scroll active/viewport |
| `wait` | **No** | Settle-only; use sparingly |

`text` for `type` must come from planner (or from `inputs` keys); action layer refuses empty / invented secrets.

**M1 recommendation:** support **B** first (fits existing tool-calling agents), keep **A** as the internal runtime envelope the action layer runs (planner B compiles to A, or planner emits A directly).

## Legal DOM action space

After each settle, `observe()` returns a snapshot:

| Field | Notes |
|---|---|
| `id` | Snapshot-local stable id for this observe only (or backend nodeId if durable) |
| `role` | button, link, textbox, … |
| `name` / `label` | Accessible name |
| `value` | Current value (redact if `secret_inputs`) |
| `enabled` / `visible` | Disabled targets are not choosable |
| `bounds?` | Optional; **not** required for legal click if id is present |
| `meta.options?` | For `<select>` |

**Rules:**

1. `click` / `type` **must** resolve to an `id` present in the **latest** snapshot.
2. `press` / `scroll` / `wait` do **not** require a snapshot id (see table above).
3. Coordinate-only clicks are **denied** in M1 (exception list later for canvas-only hosts).
4. Label matching: exact label → role/`near` disambiguation → else follow **Replan vs terminal** (grounding miss / ambiguity).
5. Snapshot ids are **not** identities across observes; re-ground every step.

## Execute → settle → verify

1. **Gate:** ownership + `INTERACTIVE` + input grant if the path touches user-facing control; agent automation uses worker CDP path, not stolen noVNC pointer.
2. **Execute** one grounded action through existing browser APIs (consumes one `max_actions` unit when counted).
3. **Settle:** wait until (a) in-flight fetches started by the action complete or timeout, and (b) DOM mute window (no meaningful tree signature change for `quiet_ms`, default **150**). Cap with `settle_timeout_ms` (default **2000**). Do not treat clock/progress-only changes as “reacted”. Impl may expose both as config; defaults are normative for M1 probes.
4. **Verify step:**
   - `type`: field value equals requested text
   - else: signature changed **or** target gained focus; change alone ≠ task complete
5. **Then apply Replan vs terminal** below (anti-loop is part of that table, not a free “BLOCKED or replan” choice).

## Replan vs terminal (normative)

Implementers **must** use this table; there is no discretionary “BLOCKED or replan”.

| Situation | Outcome |
|---|---|
| Missing literal the field needs (OTP, password, address, unpaid form value) — including anything that would require inventing `secret_inputs` | **`NEEDS_INPUT`**. Never replan to invent secrets. |
| Grounding miss (label not in snapshot) **or** label ambiguity after role/`near` | **`NEEDS_AGENT`**. Optional (not M1-required): one cheap non-frontier disambiguation among legal candidates; if still ambiguous → `NEEDS_AGENT`. Does **not** burn `max_replans`. |
| Step verify fail, remaining planned steps exist **or** replan budget remains (`replans_used < max_replans`) | **Replan** once (frontier): increment `replans_used`, discard rest of current step list, new `act`/`Subtask` from current screen. |
| Step verify fail **and** `replans_used >= max_replans` | **`BLOCKED`** (or **`FAIL`** if planner already said impossible). |
| Anti-loop: identical action + same control-state as a prior admitted action | **`BLOCKED`** (do not send input). |
| Anti-loop: same action identity ≥ 3 times without goal progress | **`BLOCKED`**. |
| Two consecutive unverified effects **and** `replans_used < max_replans` | **Replan** (counts as one frontier replan). |
| Two consecutive unverified effects **and** replan budget exhausted | **`BLOCKED`**. |
| No legal actions in snapshot for a required `click`/`type` | **`BLOCKED`**. |
| `max_actions` exhausted before verification criteria hold | **`BLOCKED`**. |
| Verification criteria hold | **`DONE`**. |
| Constraint / policy violation (e.g. would click 立即支付) | **`FAIL`** or **`NEEDS_INPUT`** (扫码) — never execute the forbidden control. |
| User 接管 / cancel | Cancel run; not a planner terminal — Ownership wins. |

**Replan** means exactly one additional frontier planner turn that emits a new step list / subtask. It is **not** per-click reasoning. Exceeding `max_replans` is always terminal (`BLOCKED`/`FAIL`), never silent continue.

## Terminal states (align M2)

| Status | Meaning | UI / chat |
|---|---|---|
| `DONE` | Verification criteria hold | Normal completion; `chat.final` allowed |
| `FAIL` | Cannot complete in this browser context / policy stop | Explain; no fake success |
| `NEEDS_INPUT` | Missing literal (OTP, address, 密码, …) | Pause; request user / form; no final |
| `NEEDS_AGENT` | Ambiguity / grounding miss needing human or higher reason | Pause; offer 接管; no final |
| `BLOCKED` | Anti-loop, budget exhausted, or no legal actions | Pause; 接管; no final |

**Hard mapping:** any `NEEDS_*` / `BLOCKED` / non-success **`FAIL`** **forbids** premature `chat.final` and plan-speak-as-done (extends M2).

Payment / 密码: always `NEEDS_INPUT` or `FAIL` with constraint reason — never auto-submit; **never** replan to guess a password.

## Interaction with existing pillars

- **M1 / M1b:** loop does not reload the stream; stalls still use credential refresh / reconnect without `location.reload`.
- **Ownership:** user 接管 preempts the action layer (cancel in-flight subtask); remint input grant unchanged.
- **M4 site skills:** successful plan-once traces (goal + grounded steps + verify) are good skill-draft material; draft persistence stays lifecycle=draft until publish rules say otherwise.
- **siteHost:** prefer skill hints when host matches; still must pass legal-space grounding.

## Follow-ons (not M1)

- `allowed_risks`: purchase / send / delete / close — hide or refuse risky controls unless listed (arc-cua pattern); encode 不代付 as default empty `purchase`.
- `secret_inputs`: redact from model context; type real values at execute time.
- Cheap decision model for ambiguous labels among legal candidates (Jev-like); still bounded, not a substitute for `max_replans`.
- OCR fallback only when a11y/DOM empty (canvas).

## Acceptance probes (for a later **impl** tip)

1. Unit: grounding rejects targets absent from snapshot; accepts exact label match.
2. Unit: settle ignores ambient-only signature churn; verify fails when type value mismatch; defaults `quiet_ms=150`, `settle_timeout_ms=2000`.
3. Unit: anti-loop → `BLOCKED` on repeated same action+state; never “replan or block” nondeterministically.
4. Unit: Shape B without explicit budgets still enforces defaults `max_actions=20`, `max_replans=2`; third frontier replan attempt → `BLOCKED`.
5. Unit: missing OTP / password → `NEEDS_INPUT` with zero replans consumed for secret invention.
6. Integration (本机): one shopping-style subtask with `finishes_task` plan runs without per-step frontier calls; on login wall → `NEEDS_INPUT` and **no** `chat.final`.
7. Integration: constraint blocks 立即支付; status `FAIL` or `NEEDS_INPUT`, reloadCount=0.
8. 接管 mid-subtask cancels loop; pointer/keyboard grants still work (#477/#469).

## Risks

- **Id churn** on heavy SPAs → mitigate with re-ground + role/name/`near`, not cached ids.
- **Over-long settle** on streaming pages → cap + treat open long-poll as non-blocking (arc-cua ChromeBackend lesson).
- **Planner over-promise** (`finishes_task: true` wrongly) → verification criteria are authoritative, not the flag alone.
- **Dual control** (agent CDP + user noVNC) → Ownership must cancel subtask on 接管.

## Landing / process

- This tip: design doc + `.loom/registry.yaml` stream `BROWSER_PLAN_ONCE_LEGAL_DOM_M1` only.
- Impl tip later: `BROWSER_PLAN_ONCE_LEGAL_DOM_IMPL` (or same stream when design accepted).
- Pipeline: tip → 云电脑体验审核 → Account Computer 本机验收 → squash. Design-only tip: review for contract clarity; 本机验收 may be doc/registry check + unit stubs if any.

## References

- third-hand `CodexAgent` (plan-once `act` / `done` / `fail`), `PlanStep`, `RunProgress`, `ObservationState.verify`
- arc-cua Subtask JSON, terminal states, ChromeBackend settle, `allowed_risks` / `secret_inputs`
- OpenBot ROADMAP v3 pillars; iron stream/ownership rules
