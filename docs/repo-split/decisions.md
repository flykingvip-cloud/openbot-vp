# 决策记录 / Decision log

- **采样日：** 2026-11-02（Asia/Shanghai）
- **事实来源：** [G1-inventory.md](./G1-inventory.md)
- **范围：** 只登记选择。不迁移代码，不改发布配置。

本文件不代替所有者做 G0 决定，也不把试点建议升级成已批准决定。

## 下一步三个选项

| 选项 | 内容 | 状态 |
| --- | --- | --- |
| A | 写下 G0：公开 npm 面取 `public`、`internal-only` 或 `legal pending` 之一 | 开放 |
| B | 批准把 `@openbot/collaboration-core` 写成正式试点候选 | 开放。建议已经写在下面，批准本身没有发生 |
| C | 只提交本目录的盘点文档 | 进行中：由本 PR 交付。合并后记为完成 |

A 与 B 可以各自决定，互不为本 PR 的隐含结论。C 不包含 A 或 B。

## ADR-C 记录 G1 盘点

- **状态：** 进行中（本 PR）。合并后完成。
- **日期：** 2026-11-02
- **上下文：** 拆仓讨论需要一份可复核的当前事实，同时仓库还没有 G0 书面决定，main CI 也还不能当作集成测试信号。
- **决定：** 在 `docs/repo-split/` 写下目录说明、G1 盘点和本决策记录。不改包、工作流、依赖、`package.json` 发布字段、分支保护、Release 或 tag。
- **后果：** 后续讨论可以引用这些文件。引用不等于批准迁移。G3–G6 仍无定义，见 [README.md](./README.md)。

## ADR-A 公开 npm 面（G0）

- **状态：** 开放。未选择。
- **需要书面决定的三个取值：**
  - `public`：组件可以进入公开 npm。
  - `internal-only`：组件只在私有源或 workspace pin 中消费。
  - `legal pending`：法律或许可证结论未完成，此前不新增公开包。
- **决定时至少要一起看的事实：**
  - 根包 `@upbeyond/openbot` 没有 `private: true`，`publishConfig.access` 为 `public`，`repository.url` 仍是 `gmood2008/openbot`。
  - `@openbot/collaboration-core` 是 `private: true`。它的 README 写明尚未批准独立发布。
  - `packages/clawdbot`、`packages/moltbot`、`packages/cogniweave-sdk` 的 `private` 字段为空。
  - GitHub 上没有 tag，OpenClaw NPM Release（`v*`）运行数为 0。
  - 生产发布的机器记录在 `deploy/production/releases.jsonl`，不在 GitHub Releases。
- **明确不做：** 本 PR 不选择上面三个取值中的任何一个。

## ADR-B 试点候选

- **状态：** 开放。建议已记录，正式候选未批准。
- **建议：** 若进入 G2，第一候选是 `@openbot/collaboration-core`（`packages/collaboration-core`）。
- **建议理由（摘要）：** 边界是类型、状态机和策略；无运行时 dependencies；直接消费方只有两个同为 private 的 collaboration 包；表面远小于根包。完整对照见 [G1-inventory.md](./G1-inventory.md) 第 7 节。零依赖包不止这一个，本建议不把 `@openbot/aor-core`、`@openbot/evolution-core`、`@openbot/toolkit` 排进同一次试点。
- **批准 B 的含义：** 所有者同意把该包写成正式试点候选。批准 B 仍然不授权迁代码。
- **迁代码前仍须单独满足：** G0 已有书面决定；main 上有可复现的 CI 基线，并且该基线能支撑 G2 的「main 集成测试通过」；组件仓的协作者与默认分支保护按盘点第 5 节另行落地；`gmood2008/openbot` 元数据漂移有跟进决定。
- **明确不做：** 本 PR 不创建组件仓，不改 workspace 协议，不 pin 外部版本。
