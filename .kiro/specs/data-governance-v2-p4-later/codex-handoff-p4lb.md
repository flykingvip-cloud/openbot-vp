# Data Governance v2 — P4-L-b Codex Handoff (dedicated)

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/merge-live-into-main`  
**Prerequisite:** M0–M4 migration **Accepted** (`14a4f22d1d`); P4 first-wave **Accepted** (`4dd0da593f`); P4-L-a **Accepted** (2026-08-18)  
**This document records P4-L-b Codex Accept (2026-08-18). It does not claim P4-L-d or later-wave umbrella Accepted.**

---

## Scope

P4-L-b only: **dedicated regional placement** overlay + dedicated adapter path.

| In                                                                                                                            | Out                                          |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `deploymentProfile: dedicated` allow path in `placement-resolve.ts`                                                           | BYOS / cold-archive unlock                   |
| Dedicated flags (`requireDedicatedKey` / `requireDedicatedDatabase` / `replicationClass: regional`) when profile is dedicated | `replicationClass: multi-region`             |
| Dedicated regional object store under `{stateDir}/data-governance/dedicated-regional/`                                        | Mixing dedicated profile with `tenant-cloud` |
| `keyRef.kind: dedicated_tenant` on dedicated prepare/apply                                                                    | Migration inventory quarantine change        |

## Frozen contracts (this slice)

| Field                     | Value                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Unlock gate               | `deploymentProfile === "dedicated"`                                                                                        |
| `mode`                    | `dedicated` when isolated store is selected                                                                                |
| `canonicalHome`           | `dedicated_regional`                                                                                                       |
| `projection`              | `none`                                                                                                                     |
| Custodian                 | `openbot` required for dedicated regional home                                                                             |
| Region                    | Branded platform deployment-region receipt                                                                                 |
| `replicationClass` output | `regional` allowed; `multi-region` remains denied                                                                          |
| Object kind               | `dedicated_regional_object`                                                                                                |
| Key wrap                  | `wrap:dedicated_tenant:<tenantId>` / `dedicated-keyref:<tenantId>`                                                         |
| Later-wave stub           | `laterWaveAdapterAvailability("dedicated")` → `{ ok: true, adapter: "dedicated" }`; byos / cold-archive remain fail-closed |

## Deny codes retired for dedicated profile only

- `dedicated_key_unsupported` — retired **only** when `deploymentProfile === "dedicated"`
- `dedicated_database_unsupported` — retired **only** when `deploymentProfile === "dedicated"`
- `replication_unsupported` for `regional` — retired **only** when `deploymentProfile === "dedicated"`
- Blanket `first_wave_adapter_unavailable` on dedicated profile — retired except **dedicated + tenant-cloud** (isolation models do not mix)

Without dedicated profile, the three dedicated-flag denies stay first-wave fail-closed (precedence tests unchanged).

`multi-region` stays `replication_unsupported` on every profile.

## Offline invariant

Dedicated overlay does **not** move a local writable canonical off-device when `offlineRequired` is effective. Dedicated + encrypted-cloud + offline keeps first-wave `local` + managed projection.

## Tests

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/data-governance/placement-resolve.test.ts \
  src/gateway/data-governance/cognitive-promotion-apply.test.ts \
  src/gateway/data-governance/cognitive-promotion.test.ts
```

Directed matrix highlights:

- dedicated profile + encrypted-cloud + dedicated flags → `mode: dedicated`, `canonicalHome: dedicated_regional`, `replicationClass: regional`
- dedicated profile + local-only and no flags → stays `local-only`
- dedicated flags without dedicated profile → original deny codes
- multi-region still denied on dedicated profile
- legal hold blocks dedicated regional move
- apply e2e writes `dedicated_regional_object` under `dedicated-regional/`
- byos / cold-archive adapter stub still fail-closed

## Non-goals (unchanged)

- `laterWaveLocked()` migration quarantine still treats all `laterWaveAdapter` sources as blocked
- No second writable canonical; tombstone order unchanged from P4 first-wave

---

## Submit checklist

- [ ] Codex review dedicated overlay + keyRef.kind + receipt union
- [ ] Cross-tenant false allow = 0 on directed matrix
- [ ] First-wave dedicated-flag precedence tests remain green

## Changes Required follow-up (2026-08-18)

Codex returned **Changes Required** (not Accept). Path containment + encrypt `keyRef.kind` runtime checks:

- Shared resolver: `cognitive-promotion-adapter-path.ts`; `dedicatedRegionalObjectPath` used by both write and unlink
- `encryptDedicatedRegionalObject` requires `keyRef.kind === "dedicated_tenant"` at runtime (platform keyRef rejected)
- Directed negatives: `cognitive-promotion-adapters.test.ts`

## Codex Accept (2026-08-18)

**P4-L-b Accepted.** Later-wave umbrella remains **not claimable** until P4-L-d is Accepted.
