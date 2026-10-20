# Operator Runbook — `recovery_required` / quarantine / receipts

**Scope:** P1 first-wave Catalog (Workspace / Agent / Conversation Archive)  
**Audience:** platform operators (`operator.admin` / `operator.read` as noted)

## Authority

- Durable Catalog at `{stateDir}/data-governance/catalog.json` is the governance SoT.
- Recovery receipts live under `{stateDir}/data-governance/recovery/`.
- Quarantine trees live under `{stateDir}/data-governance/quarantine/`.
- Process-local workspace resolver projection is **not** authoritative for inventory.

## List recovery debt (machine-checkable)

```text
dataGovernance.inventory.listRecoveryRequired  { tenantId? , resourceType? }
dataGovernance.inventory.list                  { lifecycleState: "recovery_required", ... }
```

Tenant-bound callers are scoped to membership tenant. Platform admins may filter by tenant.

## List / read compensation receipts

```text
dataGovernance.recovery.listReceipts  { operationId?, limit? }   # platform admin
dataGovernance.recovery.getReceipt    { operationId, stage }     # platform admin
```

Receipt file naming: `{operationId}-{stage}.json`.

## Clear / quarantine procedure

1. **Inventory** — list `recovery_required` rows; note `resourceId`, `canonicalLocator`, `updatedAt`.
2. **Correlate receipts** — `listReceipts` / `getReceipt` for the create `operationId` (from receipt filenames or compensate logs).
3. **Decide:**
   - **Retry compensate / finish quarantine** — re-run create-owned abort for the operation if markers still present (dev/test: call production compensate helpers with same `operationId`).
   - **Manual quarantine** — move create-owned paths only when `.openbot-gov-op.json` marker matches `operationId`; never delete unmarked user content.
   - **Mark quarantined** — after physical quarantine succeeds, Catalog lifecycle should be `quarantined` (not deleted).
4. **Verify** — `listRecoveryRequired` empty for the tenant (or only intentional holds remain); receipts retained for audit.
5. **Do not** hard-delete Catalog rows to “clear” debt; do not resume dual writers.

## Diagnose duplicates / orphans

```text
dataGovernance.inventory.diagnose  { observedLocators?: string[] }  # platform admin
```

`duplicateCanonicals` must be empty for a healthy tenant. Orphans require either registration or deliberate retirement of the observed locator.

## Fail-closed reminders

- Managed writes deny when Catalog is unavailable — no path fallback.
- Personal Local may serve **read** from a last-good snapshot; writes still fail closed without live Catalog when required by policy.
