# LIVE 未登记滚动 — 发布治理事件与 remediation（只读结论）

**事件 ID:** `GOV-LIVE-ROLL-20260912`  
**审计时间:** 2026-09-12T09:02:00+08:00  
**主机:** `8.217.93.71`  
**容器:** `openbot-gateway-rc`（未修改）

## 事实摘要

| 来源                   | Commit                                     | Digest                      | Provenance tag                                                                                   | Ledger 行                    |
| ---------------------- | ------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------- |
| **LIVE 实测**          | `6bd4569606fd286b7d8b46fb7d9198fb7a134493` | `sha256:cae8337e9b596…`     | 镜像本地 tag `rc-amd64-provenance-6bd4569606`；**无** `provenance/sha-6bd4569606fd` git tag 入账 | **无**                       |
| **Ledger seq78**       | `79f2d5f57b9170877e24e40b76bb8982f63e4bb1` | `sha256:56ae6ad69fda7c2cb…` | `provenance/sha-79f2d5f57b91`                                                                    | seq 78，`liveVerified: true` |
| **中间跳（主机镜像）** | `f0dec72227…`                              | `sha256:1767b3578d65…`      | 本地 `rc-amd64-provenance-f0dec72227`                                                            | **无**                       |

**build-info.json（LIVE）：**

```json
{
  "version": "2026.7.12-rc.2",
  "commit": "6bd4569606fd286b7d8b46fb7d9198fb7a134493",
  "builtAt": "2026-09-12T01:20:34.249Z"
}
```

**OCI label revision:** `6bd4569606fd286b7d8b46fb7d9198fb7a134493`（与 build-info 一致）

## 判定

1. **LIVE `6bd45696` 是否为已批准发布？** — **否**。`releases.jsonl` 无该 commit 行；`RELEASE_RECORD.md` L3 身份仍为 seq78 / `79f2d5f57b`。
2. **是否存在对应 provenance tag（已入账）？** — **否**（仅有本地镜像 tag，无 ledger 关联）。
3. **是否存在对应 ledger 行？** — **否**。
4. **未登记滚动？** — **是**（`unregistered_rolling`）。

## 治理事件标记

- **类型:** 未登记前滚（LIVE 前滚至 `6bd45696`，跳过 ledger 登记的 seq78 `79f2d5f57b`；中间 `f0dec72227` 亦未入账）
- **处理状态:** **已识别、已文档化；待独立变更批准后再处置 LIVE**
- **本阶段禁止:** 回滚 LIVE、补打 provenance tag、修改 `releases.jsonl` / `RELEASE_RECORD.md`（除非获得独立变更批准）

## Remediation 方案（需独立批准）

### 选项 A — 回滚 LIVE 至 ledger SoT（保守）

1. 使用 seq78 digest `sha256:56ae6ad6…` 自 GHCR pull amd64 镜像（若主机已无该镜像）。
2. Recreate `openbot-gateway-rc`（非 overlay），`--verify-live` 确认 commit/digest/UI entry。
3. 登记 seq78 仍为 LIVE 或补 seq79 rollback 记录（若 rolling 窗口需审计）。

**风险:** 丢失 `6bd45696` 上已部署但未入账的变更（含 #1102 等 main 后续 commit）。

### 选项 B — 追认当前 LIVE 并补 ledger（前进）

1. 冻结当前 LIVE digest `sha256:cae8337e…` + commit `6bd45696` 为 seq79（或 seq78.1）新行。
2. 打 `provenance/sha-6bd4569606fd` annotated tag；更新 `RELEASE_RECORD.md` L3 身份。
3. `--verify-live` + R9 通过后 `liveVerified: true`。

**风险:** 若 `6bd45696` 未经完整发布门禁，追认会固化未审计状态；需补跑 verify-live 与变更说明。

### 选项 C — 维持 LIVE 不动，治理链 PR 与 LIVE 解耦（当前策略）

1. **LIVE 保持 `6bd45696`**，标记 NO-GO 生产新 cutover直至 ledger 对齐。
2. Working DNA 治理 PR 基于 **origin/main + 治理 replay** 独立验收（隔离 Canary）。
3. 合并 PR 后走 **正式 seq79+ cutover**（full-dist Dockerfile，禁止 overlay）。

**风险:** SoT 文档与 LIVE 持续不一致，直至 seq79 登记完成。

## 推荐

**短期采用选项 C**（与本任务约束一致：不改 LIVE、不开 PR 生产 cutover）。  
**中期**在发布窗口执行 **选项 B 或 A**（需 release authority 批准）。

## 相关证据

- `deploy/production/evidence/live-provenance-audit-20260912.json`
