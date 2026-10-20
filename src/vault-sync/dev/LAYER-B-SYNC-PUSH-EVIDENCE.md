# Layer B — Sync Push Evidence (superseded entry path)

> **Status: SUPERSEDED (2026-07-23 final import IA).**  
> Product decision: Vault is **not** reachable from 录入知识 → 本地文件夹.  
> Vault product entry = **TBD / 暂不开放**. Do **not** use this sheet to claim KU UI acceptance.

## Historical path (废止)

~~录入知识 → 本地文件夹 → 端到端加密仓库 → sync push~~

That path was Wave T / 方案 A and was overturned. See:

- `docs/design/openbot-knowledge-vault-sync-import-entry-merge-alignment-2026-07-23.md` §9
- `.kiro/specs/knowledge-vault-sync/requirements.md` R1
- Wave U in `.kiro/specs/knowledge-vault-sync/tasks.md`

## What still stands

- Layer A automation (client E2E / cutover smoke) remains valid for **protocol/client**.
- Component DOM tests may render `renderVaultSyncImportForm` directly.
- Full Layer B product UI sign-off requires a **future** product entry — not the current 4-tab import page.

## Operator note

If you previously filled PASS rows against the 废止 path, treat them as **invalid for product acceptance**. Re-run only after a TBD entry ships.
