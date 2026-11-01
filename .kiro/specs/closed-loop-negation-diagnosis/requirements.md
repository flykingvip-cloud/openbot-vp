# Requirements：显式任务否定写回与诊断读取

本期只做两件事：

1. 结果卡片上的「结果不符合要求」携带 `taskId + outcomeVersion`，在调用者就是该任务 `subjectRef` 时，走现有 TaskOutcome `correction`。
2. `diagnosis.diagnose` 按同一对标识只读该版本。版本不一致、无权限、缺失、读失败各自返回，不能显示成系统正常。

自由文本没有结构化目标时只澄清，不推断最近任务。引用、转述、泛泛否定和新增要求不改任何任务状态。同一句反馈不能同时写 workspace 任务和 TaskOutcome。

不部署，不打开治理执行门，不做通知、身份映射、自动复验或自动重跑。
