# 仓库拆分盘点 / Repo split inventory

- **状态：** G1 只读盘点已写入；没有代码迁移。
- **采样日：** 2026-11-02（Asia/Shanghai）
- **仓库：** [flykingvip-cloud/openbot-vp](https://github.com/flykingvip-cloud/openbot-vp)（private）

本目录只记录拆仓讨论要用的当前事实和尚未拍板的选择。它不移动包、不改 `package.json` 发布配置、不改工作流、不改 CI、不打开分支保护、不创建 Release 或 tag。

本目录没有加入 Mintlify 导航（`docs/docs.json`）。它是内部记录，不是产品文档。

## 这份目录记什么

| 文件 | 内容 |
| --- | --- |
| [README.md](./README.md) | 目录说明、G0–G6 编号、当前状态 |
| [G1-inventory.md](./G1-inventory.md) | 2026-11-02 复核过的只读事实 |
| [decisions.md](./decisions.md) | 决策记录。A/B 仍开放；C 由本目录的 PR 交付 |

事实以 [G1-inventory.md](./G1-inventory.md) 为准。决策状态以 [decisions.md](./decisions.md) 为准。

## 门禁 G0 到 G6

G0–G6 是本目录使用的门禁编号。本次只定义讨论里已经出现、并且能用仓库事实对照的三档。G3–G6 保留编号，不补写含义，避免把空编号读成已排期计划。

| 门禁 | 含义 | 状态 |
| --- | --- | --- |
| G0 | 书面决定公开 npm 面：`public` / `internal-only` / `legal pending` | 开放。见 [decisions.md](./decisions.md) 选项 A |
| G1 | 只读盘点：远程身份、工作区表面、发布账本、权限、CI 基线、试点候选 | 本目录完成。无迁移 |
| G2 | 独立组件仓试点，并且「main 集成测试通过」 | 未开始。前置是可复现的 main CI 基线，见 [G1-inventory.md](./G1-inventory.md) |
| G3 | 未定义 | 未立项 |
| G4 | 未定义 | 未立项 |
| G5 | 未定义 | 未立项 |
| G6 | 未定义 | 未立项 |

G2 的「main 集成测试通过」不能用某一条轻量工作流变绿来代替。2026-11-02 的 main tip 上，CI、CI Gate、Docker Release 的结论是 failure，且 job steps 为空。详见盘点。

## 相关文档

这些链接是盘点引用的现有材料，本 PR 不修改它们。

- [G1 盘点](./G1-inventory.md)
- [决策记录](./decisions.md)
- [开发交付链路标准](../design/openbot-dev-delivery-pipeline-standard-2026-07-20.md)
- [生产账本说明](../../deploy/production/LEDGER.md)
- [生产发布人读记录](../../deploy/production/RELEASE_RECORD.md)
- [机器可读发布账本](../../deploy/production/releases.jsonl)
- [CI Gate 工作流](../../.github/workflows/ci-gate.yml)（含约 3 秒空 step 的说明）
- [collaboration-core 包说明](../../packages/collaboration-core/README.md)

## 当前状态

- G1 盘点：已记录。
- 代码、包名、依赖、工作流、发布配置：未改。
- G0 公开 npm 边界：未决定。
- 正式试点候选：已有建议 `@openbot/collaboration-core`，尚未批准。见 [decisions.md](./decisions.md) 选项 B。
