# Phase C §8.3 — C10 主张门进度 + 非刀产品裁决 + C11 倡议（书面范围；docs-only）

> 书面范围：`phase_c_83_c10_c11`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-83-c10-c11-scope.md`（本页）+ 正文见 §2。  
> 日期：2026-09-26  
> 前置：PR #67 / `5282a5d6`（产品确认）；PR #68 / `f80ab7fa`（FC-09 处置账本）已合入 `origin/main`  
> 授权：Owner 经由 network-of-network 授权执行完整 C 侧 §8.3 序列（2026-09-26）  
> 本刀默认 **docs-only**。不改 `src/`、不新开观察旗标、不调用 `applyPreflightToTools` / `armCompletionHold`、不打开 enforce / live invoke / Fabric default-on。主张天花板：`code-present`。**不宣称 C10 pass**；**不翻转 C NO-GO**。

## 1. 目标

在 FC-09 处置账本之后，用**一页文档刀**推进 §8.3 序列中仍挡门的三块，且不踩禁止区：

1. **C10 主张门进度记录**：哪些允许登记入口已落入预检三态、哪些仍在外；明确 **C10 仍不能 pass**；登记迭代状态。
2. **非刀产品裁决草案**：对 ACP stdio 桥 / AOR / Cron·subagent 在允许选项（exemption+break-glass | delete | 另立非 soft-observe 范围）中给出默认处置，并按 network-of-network 授权记为 Owner 确认（豁免语义对齐 FC-09 编排/Fabric：登记豁免 ≠ 忽略旁路）。
3. **C11 倡议 stub**：域内权威 + 显式终结协议为**独立倡议**；禁止跨域单写权威；**未启动工程**。

## 2. 范围内（IN）

| 项 | 文件 |
| --- | --- |
| 本书面范围 | `phase-c-83-c10-c11-scope.md`（本页） |
| C10 主张门进度 | `phase-c-83-c10-claim-gate-progress.md` |
| 非刀产品裁决 | `phase-c-83-nonknife-product-adjudication.md` |
| C11 终结倡议 stub（历史） | `phase-c-83-c11-finalization-initiative.md`（现为指针） |
| C11 倡议章程包（后续） | `phase-c-c11-written-scope-acceptance.md` + `phase-c-c11-start-order.md` + `phase-c-c11-finalization-charter.md`（**chartered**；工程未启动；非 pass） |
| 最小交叉引用 | `execution-entry-inventory.md` 文末后记；`phase-c-83-allowed-entry-disposition.md` §4 指向裁决页；`phase-c-83-product-confirmation.md` §5–§6 最小指针 |

## 3. 范围外 / 禁止（OUT）

- 新 soft-observe 旗标；把「回到热路径」写成 explicit reuse-observe
- 任何 `src/` / packages 代码、旗标默认值、热路径接线
- 宣称 **C10 pass** 或静默把 Phase C **NO-GO 翻成 GO**
- 改写 Phase C 五份冻结正文 / digests；重开有界 D #58–#66
- enforce / live invoke / Gate 收紧；P8b / P8c / Tier H / §9.2 开工
- AOR core 预检 import；为观察打开 Fabric；stdio 软观察刀
- C11 **工程**实现或跨账本单点写入
- 呼叫独立验收 bot；本刀 Material Owner 不自合并

## 4. 成功标准

| 标准 | 判定 |
| --- | --- |
| 文档齐全 | 本范围 + 三份正文入库；交叉引用最小 |
| 无新旗标 / 无代码 | diff 仅 `.kiro/specs/constitutional-governance-discovery/` |
| C10 | 进度页写明 **仍不能 pass**；登记迭代未闭合 |
| 裁决 | stdio / AOR / Cron·subagent 各有默认处置 + 非忽略语义；Owner 确认语言清楚 |
| C11 | stub→章程指针；章程包另立；禁跨域单写；**chartered**；未启动工程；非 pass |
| NO-GO / 冻结 | 不改写 final-acceptance；五正文未动 |

## 5. 主张等级与验收

主张：docs-only / `code-present` 交叉引用。  
**PASS：** IN 入库；OUT 未越界；C10 仍不能 pass；无新旗标无 `src/`；未翻 NO-GO。  
**FAIL：** soft-observe 新旗标、C10 pass、C NO-GO→GO、C11 工程开工、冻结正文改写、或夹带代码。

## 6. 验收交接

独立验收 bot：按本页成功标准 + `phase-c-83-product-confirmation.md` 非授权清单审阅。  
Material Owner 不自合并；**不**直接呼叫验收 bot（由编排方交接）。

## 7. 后续章程包指针（2026-09-26）

Owner 序列第 3 项已将 C11 从 stub **升格为倡议章程**（acceptance + start-order + charter 同 PR）。  
**不**改变本页 OUT：仍禁止 C11 工程实现、跨域单写、C10 pass、C NO-GO→GO、soft-observe / enforce / P8b。  
权威正文：`phase-c-c11-finalization-charter.md`。
