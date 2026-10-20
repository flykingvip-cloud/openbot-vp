# Enterprise Commercial Billing Hardening (2026-07-18)

**Task:** `enterprise-commercial-billing-hardening`  
**Owner:** `grok-billing`  
**Status:** approved for phased implementation

## 1. Problem confirmation (code-backed)

| Area                          | Evidence                                                                                                                 | Severity |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------- |
| A. Period model               | `runtime.resolveCycleWindow` always UTC calendar month; comment admits quarterly/annual deferred                         | P0       |
| B. Settlement                 | `billing.settle` uses `bill-${randomUUID()}`; no cycle-end gate; no settlement key                                       | P0       |
| C. Quota/overage              | `computeCurrentCycleCost` never passes `usageQuota`; `computeExtraCost` defaults quota→0; usage+extra both bill full qty | P0       |
| D. Overage policy             | Types/UI have block/credits_only/PAYG; authorize path incomplete                                                         | P0       |
| E. Credits multi-store        | Ledger-first dedupe can leave bucket/tenant projections incomplete                                                       | P0       |
| F. Seats                      | assign/setRole only; no unique active seat; no deactivate                                                                | P0       |
| G. Order↔Bill↔Invoice         | Base fee on Order; Bill seat/usage/extra only; invoice links one of order\|bill                                          | P1       |
| H. Version lock               | Seats path may read current plan version; MRR uses live basePrice                                                        | P1       |
| I. Over-allocation vs overage | Governance state ≠ billable overage; workflowsOver fixed 0                                                               | P1       |

## 2. Authoritative models

### 2.1 Billing period (`CycleWindow`)

```
anchor = commercialContract.contractStart
       ?? subscription.startTime
       ?? cycle containing `at` (legacy monthly only)

lengthMonths = CYCLE_MONTHS[billingCycle]  // 1 | 3 | 12

cycleStart = anchor + n * lengthMonths  such that cycleStart <= at < cycleEnd
cycleEnd   = cycleStart + lengthMonths  (UTC calendar-month arithmetic, exclusive end)
```

Rules:

- **Never** substitute “calendar month of now” when a contract or subscription anchor exists.
- Prepaid package fee (Order) covers `[contractStart, contractEnd)`; usage/overage Bills settle each sub-window of length = plan billing cycle (for annual prepaid, usage periods are still annual windows unless product later splits monthly usage sub-cycles — **v1 = one settlement window = contract window length**).
- Renew/upgrade/cancel must close the open window at transition time and open the next with no gap/overlap (transition engine).

### 2.2 Charge / Bill / Payment / Invoice

```
Subscription Contract (locked planVersionId + commercialContract)
  ├─ Order + Payment          → prepaid base (status: paid → applied_credit on statement)
  ├─ Usage / Seat / Overage Charge events (append-only meters)
  ├─ Settlement (keyed)       → Bill (final, immutable) + CostSnapshot(final)
  ├─ Adjustment / CreditNote  → only way to change financials after final
  └─ InvoiceRequest → Invoice → amount from statement balance due
```

Statement line types: `base_prepaid`, `cycle_discount`, `seat`, `usage_included`, `usage_overage`, `adjustment`, `payment_applied`.

### 2.3 Overage policy state machine

| Policy          | Authorize                       | Meter              | Bill                |
| --------------- | ------------------------------- | ------------------ | ------------------- |
| `block`         | deny when remaining ≤ 0         | n/a                | no overage          |
| `credits_only`  | allow only if credit bucket > 0 | debit credits only | no currency overage |
| `pay_as_you_go` | allow when credits exhausted    | meter overage qty  | BillItem type=extra |

Concurrency burst caps are **orthogonal** to currency PAYG.

### 2.4 Credits consistency (outbox / stage machine)

Per `taskId` stages: `ledger_written → bucket_debited → tenant_projected → usage_record → event_published → done`.

- Dedup key remains taskId, but status is **stage**, not “ledger exists ⇒ done”.
- Retry resumes from last incomplete stage; each stage is idempotent.
- Reconciliation can redrive incomplete stages.

### 2.5 Seat lifecycle

States: `active | inactive | removed`.

- At most one **active** seat per `(enterpriseId, normalizedUserId)`.
- deactivate/remove closes open `SeatHistoryInterval`.
- Quotas and pricing always from `subscription.planVersionId` snapshot.
- Included seats vs extra seats: base fee covers included counts; seat proration only for assigned active intervals; extra seats use `extra/seat:{role}` only for count above included quota.

## 3. Settlement key & idempotency

```
settlementKey = `${enterpriseId}|${subscriptionId}|${planVersionId}|${cycleStart}|${cycleEnd}`
billId        = `bill-${sha256(settlementKey).slice(0,32)}`   // deterministic
```

Statuses: `pending | running | finalized | failed`.

- Final settle requires `now >= cycleEnd` (unless explicit admin `force` flag is **not** allowed in v1 — use `billing.preview` for estimated only).
- Concurrent settle: single async lock on store + re-read after lock; second writer returns existing finalized bill.
- Final bill immutable; corrections via Adjustment records only.

## 4. Meter contract (phase 2)

```
included = min(usage, quota)
overage  = max(0, usage - quota)
usageCost   = included * usageUnitPrice   // often 0 when package includes meter
overageCost = overage * extraUnitPrice
```

Missing price/quota on **final** settle → hard fail with `missingPriceKeys` / `missingQuotaKeys` (no silent zero).

## 5. Phased green checkpoints

1. **Period + settlement idempotency** (this phase)
2. Credits + overage policy
3. Seat lifecycle
4. Unified statement + invoice
5. Metrics, migration, E2E golden path

## 6. Non-goals (v1)

- Multi-currency
- Tax engines
- External GL export formats beyond JSON bill/invoice snapshots
- Changing UI layout (except if API contract forces field renames with defaults)
