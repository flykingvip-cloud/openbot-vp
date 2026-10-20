# Knowledge Vault Sync — Chromium Manual Acceptance Checklist

> **STOP — Product entry TBD (2026-07-23).**
>
> Current「录入知识」does **not** expose Vault. Do **not** execute this checklist against
> 本地文件夹 / 同步方式 / 同步仓库 tabs. Operator walkthrough below is a **future-entry template**
> only — usable after a dedicated Vault product entry ships.
>
> Automated component tests (`renderVaultSyncImportForm` Chromium DOM) ≠ product UI acceptance.

---

## Purpose

Human sign-off for P1/P4 UI flows that automated scaffolds do not cover, **once a product entry exists**.

Automated counterparts (protocol/client scaffolds, not KU product entry):

- `ui/src/ui/vault-sync/client-sync.e2e.browser.test.ts` (Wave K)
- `ui/src/ui/vault-sync/client-team.e2e.browser.test.ts` (Wave O)
- `ui/src/ui/vault-sync/client-restore.e2e.browser.test.ts` (Wave R)

**Honest scope:** Green automated tests alone do **not** substitute for checked boxes below.
Overall manual UI remains **not accepted** while entry = TBD.

## Prerequisites (future entry)

- Chromium (or Chrome) with File System Access API enabled.
- Local OpenBot gateway running with Vault Sync RPCs (`knowledge.vault-sync.*`).
- A **product Vault entry** (not 录入知识 → 本地文件夹). Location TBD.
- Two browser profiles or two machines for dual-device steps (optional but recommended).
- Test vault password recorded offline; do not paste into issue trackers.

## Checklist (future entry — do not run until entry ships)

Record `PASS` / `FAIL` / `SKIP` / `BLOCKED` and operator + date on each row.

| #   | Step                                                   | Expected                                                        | Result  | Operator / Date |
| --- | ------------------------------------------------------ | --------------------------------------------------------------- | ------- | --------------- |
| 1   | **建库** — via **future** Vault product entry → create | Vault id returned; salt shown once; no plaintext on network tab | BLOCKED | entry TBD       |
| 2   | **选文件夹** — bind local directory (FSA picker)       | Directory handle persisted; re-open restores binding            | BLOCKED | entry TBD       |
| 3   | **Sync push** — add `notes/hello.md` → sync            | Revision accepted; ciphertext blob; UI synced                   | BLOCKED | entry TBD       |
| 4   | **Sync pull** — second device/profile pull             | File decrypts locally; content matches                          | BLOCKED | entry TBD       |
| 5   | **Team enable**                                        | Owner wrap uploaded; team badge                                 | BLOCKED | entry TBD       |
| 6   | **Invite**                                             | Invite id + secret once; no BaseKey on wire                     | BLOCKED | entry TBD       |
| 7   | **Accept invite**                                      | Member active; can decrypt after sync                           | BLOCKED | entry TBD       |
| 8   | **Revoke + epoch**                                     | Member revoked; encryption version +1                           | BLOCKED | entry TBD       |
| 9   | **Epoch bump**                                         | New writes use N+1; revoked cannot decrypt                      | BLOCKED | entry TBD       |
| 10  | **Restore**                                            | Prior revision restored; tombstone cleared                      | BLOCKED | entry TBD       |
| 11  | **>1MB upload**                                        | HTTP chunk or S3 objectUpload; no full WS Base64                | BLOCKED | entry TBD       |

## Network spot-checks (any failing step)

- [ ] No `contentBase64` carrying full file plaintext for large files.
- [ ] No relative path or filename in revision metadata on the wire (opaque ids only).
- [ ] Revoked member receives `403` / member error on vault RPCs after rotate.

## Sign-off

| Field               | Value                            |
| ------------------- | -------------------------------- |
| Gateway build / tag |                                  |
| UI build / tag      |                                  |
| Product Vault entry | TBD / not shipped                |
| PG primary enabled? | yes / no                         |
| S3 blob backend?    | yes / no                         |
| Overall manual UI   | **FAIL** (entry TBD)             |
| Notes               | Do not accept while entry is TBD |

**FAIL criteria:** Entry still TBD, or any required row FAIL without waiver → P1/P4 manual UI remains **not accepted**.

## Operator walkthrough — FUTURE ENTRY TEMPLATE ONLY

> **Do not execute against current 录入知识 UI.** Steps below assume a dedicated Vault
> product surface exists (name/path TBD). Until then, every step is BLOCKED.

1. Open the **future Vault entry** (not 本地文件夹; not 同步方式 selector — those are removed).
2. **建库**：create Vault → set sync password → record `vaultId` (Network: no password / no plaintext body).
3. **选文件夹**：FSA bind → refresh → binding restores (or re-pick with remembered grant).
4. **Sync**：create `notes/hello.md` → sync now → UI shows synced.
5. **(Optional)** second profile pull; content matches.
6. **Team**：enable → invite → accept → dual sync.
7. **Revoke**：owner revoke → encryption version +1; revoked RPC fails.
8. **Restore**：delete then restore from history / tombstone path.
9. **>1MB**：large file → Network shows HTTP chunk or S3 PUT, not full WS Base64.
10. Fill checklist PASS/FAIL + date; Overall manual UI only when entry is shipped.

## History (superseded — do not follow)

- ~~录入知识 → 本地文件夹 → 端到端加密仓库~~ (方案 A / Wave T) — **废止** 2026-07-23.
- `LAYER-B-SYNC-PUSH-EVIDENCE.md` — SUPERSEDED; invalid for product acceptance.
- Wave S/U component Chromium DOM tests remain valid for **form components only**.
