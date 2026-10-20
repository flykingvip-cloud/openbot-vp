# Tasks - v113 WeCom Integrity Recovery

## Agents

- codex-v113-wecom-integrity · role: owner · scope: restore the complete bundled WeCom loading contract from 6c1f5077da without OAuth identity semantics · paths: extensions/wecom/\*\*, src/plugin-sdk/wecom.ts, src/plugin-sdk/subpaths.test.ts, src/plugins/config-state.ts, src/plugins/config-state.test.ts, src/plugins/loader.test.ts, scripts/release-check.ts, scripts/write-plugin-sdk-entry-dts.ts, tsconfig.plugin-sdk.dts.json, tsdown.config.ts, vitest.config.ts, package.json, .kiro/specs/wecom-bundled-plugin-loading/tasks.md, deploy/production/RELEASE_RECORD.md, .loom/registry.yaml · since: 2026-07-25

## Tasks

- [x] 1. Compare `6c1f5077da` with the current production SoT and record behavior divergences. — codex-v113-wecom-integrity
- [x] 2. Restore the dedicated WeCom plugin SDK, bundled auto-enable behavior, lazy dispatch boundary, webhook verification coverage, and release artifact gates. — codex-v113-wecom-integrity
- [x] 3. Pass scoped tests, full Docker build, release-check, and isolated-image runtime verification. — codex-v113-wecom-integrity
- [x] 4. Cut over v113 from the current SoT tip, verify all domains and WeCom runtime, retain v112 as `prev-v113-safety`, then finalize the release record. — codex-v113-wecom-integrity

## Backlog

- [ ] v114+: review `1183cc2bc7` separately for WeCom/Feishu/DingTalk OAuth inbound identity semantics; it is explicitly excluded from v113. — codex-v113-wecom-integrity
