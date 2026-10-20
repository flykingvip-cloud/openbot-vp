# Accepted governance production overlay (locked flags)

#657 已批准后，已把锁定功能状态的 `origin/main` 覆盖到生产。这是 **overlay LIVE**，不是 Item 7 met，不是 Phase 1B unlock。

部署 ≠ 解锁。

## Identity

| Field                                | Value                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| old LIVE                             | `33993e52e5540f76e57d66ab75d8955420437d3a`                                      |
| `origin/main` / candidate / new LIVE | `47d6934c34dced654652f027f2c66fedea35a67f`                                      |
| build-info                           | `47d6934c34dced654652f027f2c66fedea35a67f` (`builtAt=2026-08-23T13:52:23.069Z`) |
| voided stale candidate               | `6e7ca8e50436cbe7c818d2ff30f9a838eb57a3ea`                                      |
| Batch 17                             | already on trunk via #654                                                       |
| remaining / liveWriteWatchIndex      | 17 / 17                                                                         |

## Forced gates

```
git fetch origin
origin/main = 47d6934c34dced654652f027f2c66fedea35a67f
git merge-base --is-ancestor 33993e52e554 origin/main = true
verify-forward-only --candidate 47d6934c34 --live-sha 33993e52e554 → allow
verify-delivery-alignment → PASS=7 WARN=3 FAIL=0
```

## Tests

Directed suite: **6 files / 64 passed** (Item 6 sqlite + CR2 + S17 + S28).

Clean archive build:

```
git archive 47d6934c34 → /tmp/openbot-build-47d6934c34
pnpm install --frozen-lockfile
GIT_COMMIT=47d6934c34 pnpm build
```

UI entry stayed `index-Dpg8P1UR.js`. Overlay gate: tip/full OK.

## Delivery / overlay

| Field          | Value                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------- |
| provenance tag | `provenance/sha-47d6934c34` pushed                                                                |
| image digest   | `sha256:b09953827133890b162dcd47dda12509bdf4a7a86d6d57e32b221dbd41b8b257` (unchanged base)        |
| ImageID        | `ca71ba79d8009c219b9aa1fa79fe6349b0cfd32621b0f3212cbd5146dc8b1d8c`                                |
| container      | not recreated                                                                                     |
| StartedAt      | `2026-08-23T13:55:05Z`                                                                            |
| ledger         | seq 41; seq 40 `liveTo=2026-08-23T13:55:05Z`                                                      |
| rollback       | `/root/openbot-maintenance-origin-main-47d6934c34-full-dist-r1-20260823T135445Z` → `33993e52e554` |

## Smoke

- healthz `live`
- readyz `ready:true` `failing:[]` (restart script saw a 503 race; re-read ready)
- served UI `assets/index-Dpg8P1UR.js`
- catalog.json mtime `2026-08-20` sha256 `46116b62…` **not written**
- registry.json mtime `2026-08-20` **not written**
- inbound / CSC process env still unset
- no data delete / physical migration

Directed tests remain the tenant-isolation / catalog-miss / membership / deny-no-write evidence for this SHA.

## Flags (still closed)

| Flag                                  | Value      |
| ------------------------------------- | ---------- |
| item7                                 | not-met    |
| phase1bExecutionBlocked               | true       |
| phase1bUnlock / fullUnlock            | not-issued |
| deployAuthorized                      | false      |
| live (Item 7 write)                   | forbidden  |
| productionCatalogWrite                | none       |
| schemaV2ProductionWrite               | false      |
| I3 / physical migration / data delete | false      |

## Rollback

```bash
BK=/root/openbot-maintenance-origin-main-47d6934c34-full-dist-r1-20260823T135445Z
# restore $BK/container-app-dist.before.tgz into /app/dist
# returns overlay 33993e52e554; image stays rc-amd64-provenance-5c221b9ec3
```

Do not enable Item 7 or Phase 1B on rollback.
