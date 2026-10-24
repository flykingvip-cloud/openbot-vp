# 交给执行 Agent 的指令

## 可直接复制的任务正文

你负责执行本交付包，目标落库目录为 `.kiro/specs/delivery-reliability-evidence-program/`。本包目前独立保存；先阅读包内文档，完成基线与任务归属登记后再落库。不要假设仓库已存在这些文件或有效的历史登记。目标是让 OpenBot 的交付可靠性和经验收益可验证，并同期形成许可审计材料。先完整阅读 README、baseline-and-architecture、work-packages、verification-and-rollout、license-audit、tasks。

本次起步只交付 WP-00：刷新基线、核对已有专项与所有权、重建真实调用图、冻结试点与证据合同输入、给出后续精确改动路径。不要先开 Fabric、调度或 auto 开关，不要改 scaffold 常量，不要拆服务或更换 LICENSE。WP-00 的事实和缺口通过复核后，再按依赖推进一个小工作包。继续实施以本计划中各阶段的具体范围为准，不要求用户重复批准已授权的普通开发，但生产、权限扩大或许可政策改变须另有明确授权。

## 开始之前

1. 读取当前 AGENTS 与目录规则；`git fetch origin`，验证 `git merge-base --is-ancestor origin/main HEAD`。失败则遵循仓库要求停止依赖变更；不得以提交日期比较新旧，不自行切分支或建 worktree。由人提供隔离目录。
2. 检查 `git status`、Loom 和旧 spec 的尾部更新；不触碰其他任务 WIP。接管旧任务先核验 diff/测试/证据，然后用 `pnpm loom register --task <existing-id> --owner <you> --session-id <uuid> --ide <ide> --agent <you> --via verified` 留下接管链。
3. 新工作包可登记为独立任务，只认领精确路径；本计划文档 owner 不自动成为所有运行代码 owner。共享热点由一个 lander 集成。
4. 本基线缺 `.agents/skills/PR_WORKFLOW.md`，实际 PR 前搜索最新规则；合并必须执行全局 `/reviewpr` 与 `/landpr`，不能编造检查结果。
5. 基线已前进时更新 manifest 与受影响分析，旧计划中的行号/默认值只作索引，必须重读源码。

## 三条硬约束

- Fabric：只比较策略快照，零第二次执行、零第二次审批；先只读试点，再在幂等与核对成立后纳入写操作。一个动作固定一个执行所有者，失败不能暗中走 legacy 再执行。
- 编排：优先补恢复、租约/fencing、deadline/取消/预算、动作幂等；复用现有实体与存储。超时未知先核对，无回查能力的写操作人工处理，不增加 planner 智能掩盖恢复缺口。
- constitutional-runtime：通过现有强制边界实现内部有效约束，不建立新策略器/调度器/任务完成账本，不以独立服务或布尔声明作为成果。

## 提交和回报

- 每个绿色逻辑单元使用 `scripts/committer` 提交，仅含本任务文件，带 `Task: <spec-name>` 和 `Agent: <agent-id>` trailers。不得把本计划所有工作合成一个大 PR。
- 对逻辑变更提供回归反例及真实入口集成；运行源码范围对应的诊断、测试与规定构建。记录命令、退出码、SHA 和局限，不只写“测试通过”。
- 变更前后执行归属检查；历史全局冲突单列，不能为使检查变绿而改他人 registry owner。
- WP-00 第一次回报应包含：当前 baseline、现有工作映射、真实入口矩阵、存储复用 ADR、试点草案、所有权冲突、下一工作包最小切片和验收命令。
- 任务完成后更新 tasks，附证据 manifest 与签名。没有业务样本时完成可复现实验设施，但业务收益保持 unknown/inconclusive。
- 只报告已证明的范围；PR 合并、本地集成、生产运行、业务收益是四个不同事实。

## 禁止的完成方式

- 只把默认 false 改 true，或把 assist 改 auto。
- 只增加抽象接口、演示数据或 happy-path mock，声称已有可恢复执行。
- 以安装成功、模型自评、文本长度或资产应用次数证明业务收益。
- 通过重复外发、重复提交客户订单验证重试；双执行器同时写同一真实业务动作。
- 将历史 shadow 评审扩大为 enforce 授权，将账户沙箱声明扩大为完整 Gateway 隔离。
- 删除事实、清除幂等记录、重置失败分母或覆盖历史证据来消除异常。
- 更换 LICENSE 或移除版权声明，将 git author 直接视为重许可授权。
