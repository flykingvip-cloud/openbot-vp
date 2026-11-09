# 执行与交互故障隔离

基线 a365e86bd7cca82c7c2efa1fa8727378fb503b1d，加本轮补丁测试。任务 agent-runtime-convergence，owner codex-runtime-manager。

## 实现

- 不新增备用执行器/模型配置/持久调度状态。普通交互继续使用已有 runGovernedInteraction → 共享模型授权/预算/回退/计费/取消 → 一次 completion，tools=[]。
- 入站宿主为本回合建立来源边界：对话持久化/读取、任务板读取、bootstrap上下文读取中的已知本地I/O或格式错误，不再直接阻断普通回答。仅这些源读取错误允许降级；授权、预算、取消与未知异常不被通用catch吞掉。身份校验和租户范围没有放宽。
- state 新readForInteraction采用严格读取，损坏任务板不再冒充“无任务”；不存在看板仍是合法空状态，读取不创建文件。旧读API保持兼容，没有改变全部旧存储行为。
- 受限模式进入已有模型输入协议，保留可用授权上下文，告知缺失来源。command强制阻止execution_request/task_change/task_control进入准入或状态修改，即使模型返回动作决定也只答限制说明。不再调用第二次模型。
- 任务写入抛出已知I/O错误时结果记unconfirmed，不重试、不启动执行，不声称没有写入。修订写入同样不虚报成功。原任务、attempt、成果不在此清空或标完成。
- 回复正文显示中文限制说明；channelData.runtimeInteraction附受限模式和固定reason codes，前端无需解析模型文字来取得状态。现有UI可显示正文；未新增专门的状态徽标/恢复按钮，已有任务恢复入口仍按原授权/停止校验。
- chat.interaction_restricted通过原lifecycle观测通道记录固定原因码；不存用户正文、密钥或原始错误路径。新的消息重新探测来源，不形成“自动恢复任务”的后台机制。
- 如果只是助手回复持久化在动作成功之后失败，附加“回复未保存，动作以上述回执为准”，不把已经生效的动作误说成未执行。

## 验证

11 files / 99 PASS：source boundary、strict board read、prepared governed interaction、route、execution admission、model completion、shared authorization、task reply、inbound host、history/context、stage events。

覆盖EACCES/EIO/ENOSPC/EROFS、腐败JSON、普通消息不建任务、一次completion/无工具、动作提议硬拒绝、无准入授权/提交、模型授权拒绝不调用provider、未知/取消/预算异常不被降级吞掉、部分写入不重试、任务状态保持原字节。

pnpm tsgo PASS；architecture 72 rules PASS；19修改文件typed lint 0 errors/0 warnings；git diff --check PASS。pnpm build PASS，动态导入警告217次及UI chunk大小警告仍在；构建不代表生产生效，未重启任何Gateway。

新增测试是在实现过程中建立的故障注入测试，不伪称所有用例都已运行修前红测。无真实模型/渠道/生产演练，不把这些单元/宿主测试当作上线终验。

## 边界

- 此能力隔离可恢复的源I/O故障，不能在Gateway进程退出/代码无法加载时提供同进程对话服务。
- 模型不可用、身份/合同/预算拒绝仍遵守原规则，不允许“直聊”绕过。
- 工作区/身份前置授权本身失败不纳入可选来源丢失；仍拒绝，避免数据越权。
- source availability是本回合事实，不是第二任务状态机。工具/沙箱故障不会通过本功能自动重跑旧任务。
- 先前14项协作失败、PPT实物缺口与CI计费问题不因本功能通过而关闭。飞书按用户指示继续跳过。

— codex-runtime-manager
