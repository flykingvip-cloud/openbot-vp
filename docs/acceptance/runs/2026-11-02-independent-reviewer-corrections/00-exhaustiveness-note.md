# 公开入口穷尽性核对（只读，2026-11-02 Asia/Shanghai）

**结论先行：tracked ID 表（原 66 / 拆分后 70）不能证明覆盖完整。**  
分列 Cap / Static / Compile / Runtime 是正确改进，但清单仍未穷尽公开入口。

## 对照来源（tip WT `openbot-acceptance-main-d42fbc3ca2`，只读）

| 来源 | 观察 |
| --- | --- |
| CLI `openbot --help` | **49** 个 top-level commands（含 `acp`/`backup`/`gateway`/`tui`/…） |
| `extensions/*/openclaw.plugin.json` 含 `channels` | **24** 个 channel 插件（含 nostr / twitch / wechat） |
| `docs/channels/*.md` | 与上述 channel 文档大体对齐（另有 routing/groups 等 meta） |
| `apps/` | android / harmony / ios / macos / shared / windows |
| Control UI `ui/src/ui/navigation.ts` | frontstage / enterprise / platform / console 多组 Tab 与大量 deep-link 路由 |
| `packages/` / 非 channel extensions | collaboration-*、memory-*、voice-call、acpx 等 |

## 已覆盖（表内有 ID，且本轮有证据或明确状态）

- CLI：**仅** help 表面（C-CLI-HELP PASS）——≠ 49 命令各自 runtime  
- Channel：**静态** 24 行（本轮将 nostr/twitch/wechat 与 tip plugin 对齐；live 全 NOT_RUN）  
- Apps：6 端 PRESENT；编译多为 BLOCKED  
- Control UI：build + static；interactive NOT_RUN  
- Backup omit：缺陷登记 FAIL + 独立复现 BLOCKED  
- P1-DEF001/002/004 PASS（历史合入）；DEF-008 FAIL 登记  

## 疑似缺口 / 未穷尽（不得虚构 PASS）

1. **CLI 逐命令 runtime / 子命令树**（agent、channels login、devices、sandbox、secrets、webhooks、conversation-task…）— 未逐条 ID。  
2. **Control UI 路由/导航**：enterprise / platform / ops / builder / employee / capability / usage 等 — 未按路由列入。  
3. **非 channel extensions**（memory-core、memory-lancedb、voice-call、phone-control、acpx、diagnostics-otel、…）— 稳定 ID 表未列。  
4. **packages/** runtime（collaboration-core / runtime / adapter、AOR、evolution…）— 未列或仅间接 BLOCKED。  
5. **旧表 ID 漂移**：曾出现 `wecom-app` / `qqbot` / `openclaw-weixin`，tip 上未见对应 channel plugin.json — **疑似过时或未核入口**；已从本轮表移除且**不**标 PASS。  
6. **跨仓安装面**（openbot.love install scripts）— 仍 NOT_RUN / 跨仓依赖。  
7. **ACP bridge、TUI、dashboard、node host** 等公开入口 — 仅可能被 CLI help 间接触及，无独立验收行。  
8. **无法在无凭证下核对的入口**：全部 channel live、pairing、enterprise IM、真实 OAuth、生产 gateway doctor — 记 NOT_RUN/BLOCKED，非 PASS。

## 与「66=完整」的关系

- 原「N=66」是分母硬化改进，**不是**穷尽证明。  
- 本轮去 PARTIAL 后行数变为 **70**，完整性质疑**依然成立**。  
- 任何「已覆盖完整公开入口」的宣称均 **不符合**本轮独立复核。

## 建议下一步（无需额外用户权限以外事项）

1. 以 CLI help 列表 + navigation TAB_PATHS + extensions 全量 id 生成「候选入口清单」，对未入 tracked 表者一律标 **未列入/NOT_RUN**。  
2. 恢复 collaboration workspace 构建产物后，完成 DEF-008 **独立**复现。  
3. 产品侧按收窄建议修 omit；再重跑 Stage4。  
