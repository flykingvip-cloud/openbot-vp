# 对齐指令 / 历史决策记录：知识导入入口与 Vault

- To: `cursor-vault-sync`（`knowledge-vault-sync` owner）
- From: `kiro`（知识工作台 · 录入知识入口 / 信息架构）
- Date: 2026-07-23
- Status: **§9 为最终产品决策**（方案 A **废止**）。Vault 产品入口 = **TBD / 暂不开放**；录入知识 4 tab，本地文件夹无同步方式选择器、固定 `managed_push`。
- History: §1–8 记录中间「方案 A」与 Wave T；仅作历史，**不得**再按方案 A 实现或验收。

---

## 0. Supersession notice（读本文先读本节）

| 阶段           | 决策                                                                    | 状态                     |
| -------------- | ----------------------------------------------------------------------- | ------------------------ |
| 最初           | Vault = 录入知识独立第 5 通道                                           | superseded               |
| 中间方案 A     | Vault 并入「本地文件夹 · 同步方式」三档（含端到端加密仓库）             | **废止**（用户明确推翻） |
| **最终（§9）** | 本地文件夹无选择器、固定 managed_push；Vault 彻底不在此入口；新入口 TBD | **现行**                 |

cursor-vault-sync **Wave U** 已按最终决策纠偏规格与实现假设（2026-07-23）。

---

## 1. 背景与产品判定（历史 — 方案 A，已废止）

> **历史决策 / superseded。** 以下为方案 A 时期叙述，不可再作为实现依据。完整原文见 git 历史。

「录入知识」入口经历抽屉 → 整页 → tab。当时判定 `localFolder` 与 `vaultSync` 对用户重复，拟用三档同步方式（本机索引 / 云端同步 / 端到端加密仓库）合并入口。

**决定（方案 A，已废止）**：`同步仓库` 降级为 `本地文件夹` tab 内「同步方式」的「端到端加密仓库」。

## 2–7. （历史）方案 A UI seam、交接 checklist、验收标准

> **历史 / superseded。** 含同步方式选择器、`vaultSync` 归入本地文件夹 tab、Wave T hydrate-via-method 等约定均已作废。

## 8. （历史）Wave T 回执优先级

> **历史 / superseded。** 含「跑通录入知识 → 本地文件夹 → 端到端加密仓库」等约定均已作废。i18n 三档文案亦无现行产品入口。

---

## 9. 最终决策 —— vault 从本地文件夹入口移除（kiro，2026-07-23）

运营改了产品决定：**本地文件夹 tab 只做云端同步（`managed_push`），不再显示同步方式选择器，vault 彻底不在此入口出现**（"以后另找入口/暂不做"）。这**推翻了方案 A**。

kiro Import IA（`knowledge-workbench-import-ia:kiro-web-ui`）已落地：

- 移除「同步方式」分段选择器及 folder-sync-method helpers。
- `本地文件夹` tab 直接渲染本地文件夹表单；陈旧 `importKind=vaultSync` 回退到本地文件夹 tab，**不**渲染 vault 表单。
- 默认模式应为 `managed_push`（非 `local_index`）。
- 测试：无同步方式选择器 / vault 不出现 / 陈旧 vaultSync 回退。

**给 `cursor-vault-sync` 的约束（Wave U）：**

1. **停止**按方案 A 在导入页接 vault；勿改 kiro 认领的 Import IA 文件。
2. hydrate / devices / team wiring **可为未来入口保留**，但不得依赖「本地文件夹 → 端到端加密仓库」触发。
3. spec / design / tasks：产品入口统一 **TBD / 暂不开放**；Wave T 标为已完成但被废止。
4. 不新增 `folderSyncMethod`；不提交三档 i18n；不声称 managed_push 闭环或 Vault 产品 UI 已交付。
5. `renderVaultSyncImportForm` 与 Vault controller **保留**（能力层），不在录入知识页挂载。

请以本节（第 9 节）为准，覆盖第 1–8 节中与「vault 经同步方式进入」相关的全部约定。

Signed: kiro — 2026-07-23（§9）  
Ack + Wave U：cursor-vault-sync — 2026-07-23
