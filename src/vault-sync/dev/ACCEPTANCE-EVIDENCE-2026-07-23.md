# Knowledge Vault Sync — Acceptance Evidence (2026-07-23)

> **Scope:** Implementation / automation sign-off (Layer A).  
> **Does NOT** equal P1–P4 full product acceptance.  
> Git evidence tip: `7e1ba29fc3` on branch `fix-scoped-package-templates`.

## Layer A — Implementation sign-off (SIGNED)

| Capability                         | Result      | Evidence                                         |
| ---------------------------------- | ----------- | ------------------------------------------------ |
| P0 protocol + member auth          | PASS        | Prior acceptance + gateway tests                 |
| Client E2EE sync A→B               | PASS        | `ui/.../client-sync.e2e.browser.test.ts` 3/3     |
| >1MiB HTTP upload                  | PASS        | browser E2E + node tests                         |
| S3 objectUpload direct PUT         | PASS        | `object-upload-direct.node.test.ts` + live smoke |
| Team invite + atomic revoke+rotate | PASS        | `client-team.e2e.browser.test.ts` 1/1 + Wave M   |
| Tombstone restore                  | PASS        | `client-restore.e2e.browser.test.ts` 1/1         |
| PG primary + S3 + hydrate (local)  | PASS        | `run-cutover-smoke.sh` 2/2 (2026-07-23)          |
| Mobile objectUpload client parse   | PASS (code) | Android/iOS unit tests committed                 |

### Commands run (2026-07-23)

```bash
# Node tests (browser *.browser.test.ts fail under root vitest — run in ui/ instead)
OPENBOT_TEST_PROFILE=low pnpm test src/vault-sync ui/src/ui/vault-sync
# → 78 passed; 5 browser tests need ui vitest project

cd ui && pnpm test \
  src/ui/vault-sync/client-sync.e2e.browser.test.ts \
  src/ui/vault-sync/client-team.e2e.browser.test.ts \
  src/ui/vault-sync/client-restore.e2e.browser.test.ts
# → 5/5 passed

bash src/vault-sync/dev/run-cutover-smoke.sh
# → 2/2 passed (PG primary + objectUpload hydrate)
```

**Layer A decision:** ACCEPT implementation scaffold for listed capabilities.

---

## Layer B — Chromium KU UI (PENDING operator)

Template: `CHROMIUM-ACCEPTANCE.md`  
Walkthrough: same file § Operator walkthrough

| #   | Step                           | Auto substitute                       | Manual status                                         |
| --- | ------------------------------ | ------------------------------------- | ----------------------------------------------------- |
| 1   | 建库                           | KU form + create btn (Wave S browser) | **PARTIAL PASS** (UI shell; gateway RPC 待登录后点验) |
| 2   | 选文件夹 FSA                   | pick-folder control (Wave S browser)  | **PARTIAL PASS** (控件+回调；真实 FSA 待登录后点验)   |
| 3   | Sync push                      | K browser E2E                         | PASS (client)                                         |
| 4   | Sync pull 第二端               | K browser E2E                         | PASS (client)                                         |
| 5–8 | Team / invite / revoke / epoch | O browser E2E                         | PASS (client)                                         |
| 10  | Restore 历史                   | R browser E2E                         | PASS (client)                                         |
| 11  | >1MB upload                    | K browser E2E                         | PASS (client)                                         |

**Overall manual UI:** PARTIAL — KU 表单 Chromium 4/4（Wave S）；完整 #1–2 需登录后 operator walkthrough。

### Wave S (2026-07-23)

`ui/src/ui/views/knowledge-universe-vault-sync.browser.test.ts` — Chromium **4/4**：
vault 表单、密码→建库按钮、session 后 sync/team/restore 控件、pick-folder 回调。

---

## Layer C — Mobile real device (PENDING)

Template: `MOBILE-ACCEPTANCE.md`  
**Overall mobile P3:** FAIL until device matrix filled.

---

## Layer D — Production cutover (PARTIAL)

Template: `CUTOVER-SIGNOFF.template.md`

| Check                              | Result      | Notes                                 |
| ---------------------------------- | ----------- | ------------------------------------- |
| Local PG+S3 cutover smoke          | **PASS**    | Docker stack + `run-cutover-smoke.sh` |
| Production backup + flip + hydrate | **PENDING** | Human ops window                      |
| **ACCEPT production cutover**      | **NO**      | Local smoke only                      |

---

## P0–P4 summary (honest)

| Tier | Product acceptance                | Implementation acceptance       |
| ---- | --------------------------------- | ------------------------------- |
| P0   | PASS                              | PASS                            |
| P1   | FAIL (KU UI #1–2; full-repo tsgo) | PASS (client automation)        |
| P2   | FAIL (prod cutover)               | PASS (local cutover smoke)      |
| P3   | FAIL (real device)                | PASS (code + unit scaffold)     |
| P4   | FAIL (KU team UI clicks)          | PASS (atomic revoke automation) |

**Do not mark P1–P4 package PASS until Layers B + C + D (production) are signed.**
