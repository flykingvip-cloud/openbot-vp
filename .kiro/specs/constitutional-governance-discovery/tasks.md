# Tasks：宪法治理发现（Phase A）

## Authority annotation (2026-09-27)

- Historical status: 下方「架构评审纪要」勾选与「会议纪要未召开」写在同一项。勾选当时表示文档已载明授权表。
- Superseded by: `.kiro/specs/constitutional-governance-state-convergence/current-state.md`
- Current authority: Phase A 发现文档在主干上。该勾选不是已召开的会议回执，也不授权 Phase D、constitutional-contracts、真实 Path 或 Gate 收紧。

## Agents

- `grok-bot` · role: owner · scope: Phase A 事实文档与 Loom 登记 · paths: `.kiro/specs/constitutional-governance-discovery/**` · since: 2026-09-23

注册表条目（SoT）：`.loom/registry.yaml` 任务 `constitutional-governance-discovery:grok-bot`。本任务不发明 Loom CLI。

提交 trailer：

```text
Task: constitutional-governance-discovery
Agent: grok-bot
```

## 对照执行方案 §6.4

- [x] Loom 登记当前唯一 Owner（`grok-bot`）
- [x] 产出四份正文（恰好四份；优选各 ≤300 行）
- [x] 首版 BaselineManifest 写入 `authority-evidence-baselines.md`（评审快照仅作示例；Phase A 草案使用当时 `origin/main`）
- [x] 架构评审纪要：确认「A 批准启动；D / contracts / Path / Gate 收紧当前不批准」（文档已载明授权表；会议纪要未召开）
  - Phase A 内容验收通过
  - Phase B 设计合同通过
  - Phase B 编码仍未批准
  - Phase C/D、constitutional-contracts、真实 Path、Gate 收紧仍未批准
  - 当前结论为本地内容 PASS，但 GitHub 发布仍受 Loom 登记落地约束

— grok-bot

- [x] 不创建 schema、不新建 packages、不改 feature 默认值

## 正文核对

- [x] `terminology-and-non-equivalence.md`：三条 ADR（Workflow ≠ Path；receipt ≠ proof；plugin installed ≠ capability authorized）+ 禁用别名
- [x] `execution-entry-inventory.md`：每入口九字段；未知写 `unknown`
- [x] `authority-evidence-baselines.md`：C11 目标重写 + 域矩阵 + 证据分级 + Manifest
- [x] `web-read-shadow-slice.md`：首切面 `web_read`；评估合同可检查；v1 不写生产 ledger

## 明确不做

- [x] 无第五份架构长文
- [x] 无运行时代码、无 schema、无新包
- [x] 不把 seq 96 或再生后的 seq 97 写成六周常量
- [x] 不批准 B 编码、C 的 GO、或 D
