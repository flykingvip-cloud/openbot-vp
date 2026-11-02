# 10 — Control UI / credential-free verification (2026-11-02)

**Pin:** `d42fbc3ca2b4041ee70bb1dfb9cd70f33678370c`  
**Evidence:** `../runs/2026-11-02-credentials-omit/logs/04-control-ui-probe.log`, `05-control-ui-static-smoke.log`, `06-cli-help.log`

## Results

| Step | Result | Notes |
| --- | --- | --- |
| `pnpm ui:build` | **PASS** (≈5.78s) | Vite production build; output under gitignored `dist/control-ui` |
| Static HTTP smoke `index.html` | **PASS** | Local listener `127.0.0.1:18765` — no gateway, no auth |
| Interactive Control UI ↔ gateway | **NOT_RUN** | Requires local gateway session; not started this run |
| Live / prod credentials | **NOT_RUN** | Policy |

## Toolchain already present (no install)

- Node / pnpm workspace for UI build — used successfully.
- Vitest for unit omit repro — used successfully.
- CLI binary via workspace — `--help` PASS (49 commands).

## Missing / BLOCKED (do not install without auth)

Disk on acceptance Mac ≈ **98%** used (~22 Gi free observed earlier) — **STOP** before any large toolchain install.

| Component | Impact if missing | Action |
| --- | --- | --- |
| SwiftPM unrestricted / full mac app build | ME-MAC-APP compile BLOCKED | No install this turn |
| Xcode gen / iOS signing | ME-IOS BLOCKED | No install |
| Android SDK / Gradle | ME-ANDROID BLOCKED | No install |
| Windows SDK | ME-WINDOWS BLOCKED | N/A on Mac |
| Harmony hvigor | ME-HARMONY BLOCKED | No install |
| SBOM regen network tooling reliability | SC-SBOM-REGEN BLOCKED | Not re-run |

**Stopped** before unauthorized installs. Credential-free path taken: UI build + static smoke + CLI help + backup unit/diag only.
