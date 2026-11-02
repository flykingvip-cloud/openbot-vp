# Post-main-align gates (scoped-pass docs tip)

| Field                                               | Value                                                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Docs tip SHA (scoped-pass wording)                  | `c4ebce6c77cfd51f8606bbed958a59918c1f03cf`                                                      |
| Gates-note tip SHA                                  | `7734faac23eb5004bbc3a799e36d169efec0a587`                                                      |
| Parent / align base                                 | `fde7444fba79cb74569c59e40e36106eeed29dc8` (= `origin/main` at align time)                      |
| ahead / behind vs `origin/main` (at gates-note tip) | ahead **2** / behind **0**                                                                      |
| User timezone                                       | Europe/Berlin                                                                                   |
| Mac/box clock when recorded                         | 2026-11-02T08:21:37+0800 (Asia/Shanghai machine clock) ≈ 2026-11-02T01:21:37+0100 Europe/Berlin |
| Change set                                          | docs/evidence wording only (no product code; no model re-run)                                   |

## Gate exits (measured on docs tip `c4ebce6c…`; still applies to wording-only descendants)

| Command                                                   | exit        | Note                                                                                                                                                       |
| --------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint:core:composition-root-loc`                     | **1**       | `src/gateway/collaboration-learning/shared.ts` 3458 / budget 3364 — same size on `origin/main`; **trunk pre-existing**, not introduced by scoped-pass docs |
| `pnpm tsgo`                                               | **2**       | `operating-deliverable-binding.test.ts` missing `updatedAtMs` on two `CollaborationMember` fixtures — on main tip ancestry; **not** from docs commit       |
| Official `pnpm build` / write-build-info for **this** tip | **not-run** | Do **not** attribute `3460ef9fa…` build identity to this tip                                                                                               |

## Build identity

No new runtime/build identity claimed for `c4ebce6c…` / `7734faac…`. Prior dedicated build evidence remains bound to pinned product SHA `3460ef9fa…` only.
