# Design：显式否定与诊断读取

写入口先经过 `planInboundFeedbackDisposition`。只有明确的目标改写才调用原来的 `applyGoalCorrectionMutation`。TaskOutcome 的否定不从这句话进入。

结构化写回在 `rejectTaskOutcomeResult`。allowlist 只有这次已核对的调用者。验收改为 failed，delivery 原样保留，judge 不改。关闭的任务因此得到新版本和 failure 判定，不创建新的 attempt。

诊断读取在 `readTaskOutcomeEvidence`，由 `executeParsedDiagnoseRequest` 在 `diagnosis.diagnose` 里调用。工具失败留在观察里，不改 `taskJudgement`。

旧 evolution 样本的撤销只在临时 agent 目录上调用 `publishEvolutionFromTaskOutcome` 和没有经验处理器的 `OutcomeConsumerRuntime`。`createExperienceVerifiedHandler` 会写默认工作区，本设计不调用它。
