# Mac disk inventory (read-only) — 2026-10-31 Asia/Shanghai

Status: **配置风险 / 资源线索** — not proven cause of CI empty-steps.
No deletions performed in this pass.

## Capacity
- Data volume (`/System/Volumes/Data`): **~846Gi used / ~14Gi avail (99%)**
- Root APFS snapshot view: ~12Gi used on system volume slice (not the bottleneck)

## High-value reclaim candidates (observed)

### A. Path B release leftovers (aligned with openbot cutover hygiene)
| Item | Size (approx) | Note |
|---|---|---|
| `/tmp/openbot-d37bed5117d6.oci.tar` | 2.8G | tip tar; image already local |
| `/tmp/openbot-66bad421c9bb.oci.tar` | 2.8G | older tip tar |
| `/tmp/openbot-b31c1e12ea34.oci.tar` | 2.8G | older tip tar |
| `openbot:rc-amd64-provenance-66bad421c9bb` | 2.88G | older local image |
| `openbot:rc-amd64-provenance-b31c1e12ea34` | 2.88G | older local image |
| `~/hk-cutover-*` except current tip STABLE | mostly small except `0a6daead74ab` ~1.3G | keep current LIVE short STABLE |
| Docker build cache | ~308MB reclaimable | `docker buildx prune` |

**Keep for now:** `openbot:rc-amd64-provenance-d37bed5117d6` (newest local tip), `~/hk-cutover-d37bed5117d6`.

### B. Docker unused layers/volumes (names required before prune)
- Images: 17.94GB total, **~8.97GB reclaimable** (50%)
- Local volumes: 28.92GB total, **~15.62GB reclaimable** (54%)
- Active containers include: many `aw-exec-lease-*`, `aw-browser-*`, `knowledge-sdk-ollama`, OHBE workbench, open-wearables, mysql/redis/postgres — **do not volume-prune blindly**

### C. Caches (safe-ish but may slow next install)
| Path | Size |
|---|---|
| `~/.npm` | **19G** |
| `~/Library/Caches/com.todesktop.230313mzl4w4u92.ShipIt` (Cursor updater) | 2.9G |
| `~/Library/Caches/com.openai.codex` | 2.4G |
| `~/Library/Caches/Google` | 2.4G |
| `~/Library/Caches/com.workbuddy...BundleMigration` | 1.4G |
| `~/Library/Caches/ms-playwright` | 1.1G |
| `~/.codex` | 9.3G (may hold visualizations — review before wipe) |
| `~/.ollama` | 4.6G (model store; container running) |
| `~/.cursor` | 2.8G |
| `~/.bun` | 2.1G |

### D. Explicitly out of scope without separate auth
- `aw-browser-*` / tenant dirs / LIVE host assets
- Unrelated project Docker volumes without named list
- Shared openbot checkout WIP (`Dockerfile.bak`, `handoffs/`, `vendor-docker-cli/`)
- Deleting only to “fix” CI (CI issue is runner allocation / likely minutes)

## Proposed disposal tiers (await owner GO)

**Tier 1 — release hygiene (~8–12G likely, low risk)**
1. Remove `/tmp/openbot-*.oci.tar` (all three; local images remain)
2. Remove older provenance images `66bad421c9bb` + `b31c1e12ea34` (keep `d37bed5117d6`)
3. Remove old `~/hk-cutover-*` / `/tmp/hk-cutover-*` except `hk-cutover-d37bed5117d6` (+ templates if still used)
4. `docker buildx prune -f` (build cache only)

**Tier 2 — Docker reclaim with named exclusions (~up to ~15G volumes + unused images)**
1. `docker image prune` for dangling only
2. Optionally remove unused non-openbot images (ollama/mysql etc.) **only if user confirms those stacks idle**
3. Volume prune **only** for explicitly listed unused volume names — never blanket `volume prune` without list

**Tier 3 — developer caches (recoverable cost)**
1. `npm cache clean --force` / trim `~/.npm/_cacache`
2. Clear named Library caches (ShipIt, Google, playwright) after confirm
3. Review `~/.codex` subdirs before any delete

## Verification after any approved cleanup
- `df -h /System/Volumes/Data`
- `docker images` still shows tip `d37bed5117d6`
- No running required containers removed


## Cleanup executed 2026-10-31 19:13+08 (Tier 1 + dangling)

Authorized: Tier 1 + docker image prune dangling only.

Deleted:
- /tmp/openbot-{66bad421c9bb,b31c1e12ea34,d37bed5117d6}.oci.tar (~8.4G)
- images 8e37a1bb5921 (66bad provenance), 230e2e7e015a (b31c provenance)
- dangling 567e3c17b188, 8887b8ec221d (9c9c8140d313 skipped: in use by container 87e82bfcedda)
- 11 old ~/hk-cutover-* dirs (kept d37bed tip, templates, sync-logs)
- docker buildx prune -f (~8.56G reclaimable reported)

Kept:
- openbot:rc-amd64-provenance-d37bed5117d6 (83ae38bfd33a)
- ~/hk-cutover-d37bed5117d6, templates, sync-logs

Disk Data avail: ~14–15Gi → ~32Gi (df after settle). No volumes pruned; no named non-dangling images removed beyond old provenance.
