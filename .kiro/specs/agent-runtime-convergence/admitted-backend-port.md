# 受准入单候选后端调用端口（只读设计）

## 目标与范围

当前`runAgentTurnWithFallback`混合outer admission/fallback/usage/finalizer与CLI/embedded实际后端。下一切片不整搬，不加新重试循环。先提一个真实组件：**调用一个已经由现有fallback选定且已通过原准入的provider/model候选**。其后端实现负责CLI/embedded适配及对应生命周期；原控制函数不再直接import runCliAgent/runEmbeddedPiAgent及CLI凭证执行依赖。

不接受`invoke = () => runEmbedded(params)`后原分支全部不动的空wrapper；必须移走CLI/embedded分派与后端专属prepare/invoke/result bookkeeping主体，消费者只看到单候选请求与结果。

## 已确认时序

`agent-runner-execution.ts`：enterprise run slot约548；runWithModelFallback约640；候选callback约650；onModelSelected最先；CLI budget约660后start事件与凭证桥，再runCli约715；embedded先上下文与enterprise transport解析，约887 budget→model_started→tool observer→约906 runEmbedded。warning signatures在候选返回后更新。outer finally约1497释放enterprise slot。

不能将两分支budget统一前移：那会改变transport解析/凭证解析/事件次序。

## 接口建议

在`execution/runner/admitted-candidate.ts`定义单一用例，不公开原provider函数。初期使用legacy input contract，并诚实记录待收窄：

```ts
type AdmittedCandidate = {
  provider: string;
  model: string;
  allowTransientCooldownProbe?: boolean;
};

type AdmittedCandidateResult = {
  runResult: EmbeddedPiRunResult;
  bootstrapPromptWarningSignaturesSeen: string[];
};
```

用例参数含 candidate、原本run/session/identity输入和typed callbacks；按实际语义拆成少数port，不为每字段建回调。建议生命周期ports：assertModelBudget、notifyRunStart、recordFirstToken/modelStage、onToolEvent/onToolResult、CLI usage attribution；信号/事件callback保留原序列语义。

注意“Admitted”名称不是安全凭证。仅由原gate后call site调用；能力授权仍底层检查。不要创建可从插件/配置任意构造并绕过原gate的新公开HTTP方法。

## 注入位置与依赖

- 原`runAgentTurnWithFallback`params增加`invokeCandidate`必填typed port；由agent-runner侧宿主组装一次。可先明确宿主模块`auto-reply/reply/admitted-backend-adapter.ts`提供旧依赖，实现再迁execution；公开调用不允许默认fallback偷偷import provider。
- 更稳的本批归属：新execution component持有CLI/embedded分派，宿主提供平台读取/记账adapter；wiring负责把真实runners和adapter接入。没有实际迁走原分支就不算完成。
- 重复type引用改`import type`；runResult不可用any；不要从runEmbedded函数ReturnType引runtime import。
- CLI credentialEnv仍仅在本候选作用域内，不进标准Result/日志；catch时host env fallback保持原行为，不借重构修授权策略。
- embedded参数、身份继承、abort、privateRunBag、tool observer及串行toolResultChain全部原样转接。observer可能写账，不是pure context。

## 必须留在原控制函数的内容

1. enterprise/model entitlement与mandatory governance；slot acquire/release。
2. `runWithModelFallback`以及外层transient/compaction/role-conflict恢复循环。
3. onModelSelected callback时点（候选切换时一次）。
4. outer增长/账务/商业用量aggregate与finalizer exactly-once；候选后端特有CLI attribution可返回必要结果或显式callback。
5. 候选结果后的统一错误映射、task outcome结算。

特别注意候选失败也需要合法生命周期terminal，CLI `finally`兜底应随CLI组件一起迁，不能在outer再加第二terminal。embedded usage charge和stage结束原有异常处理保持，未完成前不简化为统一finally。

## 可执行批次

A. 固定候选请求/结果与callback时序契约；补baseline spies，不增加wrapper。
B. 将CLI/embedded候选分派主体迁入新组件；原fallback callback变为onModelSelected+invokeCandidate；删除原直接provider和专属credential imports。
C. 宿主root绑定真实实现一次；旧导出保留同唯一用例，不另复制默认provider实现。
D. 扩manifest：execution candidate不能导auto-reply高层/Gateway协议；旧控制模块禁止直接import CLI/embedded provider（类型例外由现有检测能力确认）。

如果B过大，允许先迁CLI完整候选适配，但阶段报告只称CLI分支完成，不宣称主入口provider依赖已解除。

## 验证

- candidate CLI success/error/finally terminal exactly once、凭证失败host fallback、bootstrap warning更新。
- embedded transport后budget、model_started/first_token/end顺序、abort前后、privateRunBag/skipPersist标记、tool-result串行交付/pending任务清理。
- fallback primary失败secondary成功：gate/选模/usage按原次数；fallback不能复用primary auth profile。
- outer transient重试、compaction/session reset与enterprise release exactly once。
- 原真实runReplyAgent测试、credit snapshot、BYOK、entitlement、run-id及工具事件测试；契约测试用端口事件序列而不是镜像实现。
- baseline/candidate类型差量零，build动态import不增，公开入口不可访问内部provider，旧循环数不增。

## 风险/接受门槛

该候选仍是legacy adapter，含FollowupRun/TemplateContext及privateRunBag，不是最终公共SDK；必须诚实登记。根本要求是原大函数解除直接provider依赖、唯一候选实现已接真实consumer，而不是新增一个名字。若只能搬三行调用、保留原分支与provider所有权，应否决该切片设计并先做调用闭包分解。
