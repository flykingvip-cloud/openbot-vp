# 真实运行终验进度

固定行为源码：f4c5e2bbe99ba36fe28242d010157fcc95efdf4a。git archive 导出到独立临时目录，以隔离状态、配置、工作区运行；不连接生产Gateway。模型凭证仅复用本机既有配置到权限0600的临时配置，不写入仓库。

| 项目 | 结果 | 范围 |
| --- | --- | --- |
| 真实模型命令 | PASS | 生产 agentCommand→治理/准入→embedded→真实DeepSeek v4 flash→命令输出；返回 OPENBOT_REAL_MODEL_OK，17+25=42，约1955ms。不是人类chat.send的完整终验 |
| 真实协作回合 | PASS | 生产 executeCollaborationRound，primary/supplement 两次真实模型生成/核验；ROUND_COMPLETE，两个dispatch accepted。未用模型替身 |
| 协作组契约宿主链 | PASS（限定） | 独立临时租户/ACL成员/真实ownership登记；生产publish→claim→apply→确认待办→in_progress→真实模型成果正式入组库→submit_for_review→非作者accept→组成果ACL读取；status accepted，版本/正文SHA绑定通过。宿主按验证步骤驱动，不宣称模型自主调用全部工具、事件队列全自动调度或外部群送达 |
| 飞书真实外发 | SKIPPED | 用户明确要求先跳过；不算通过、不使用新提供密钥外发 |
| PPT实物 | OPEN | 原生PowerPoint自动化报noWindowsAvailable/timeout；隔离渲染镜像在服务器临时构建，未覆盖生产镜像，apt-get阶段长时间无进展；不能用文字版或旧版本证据填PASS |
| CI | BLOCKED | GitHub明确提示付款失败/额度限制导致job未启动，无step；不是源码绿，也不擅自绕过 |

真实模型和组契约探针有少量Gateway token缺失告警，命令侧嵌入模型与组契约链成功；这些告警不能视为Gateway网络入口已通过。原始日志位于本机/tmp，可能含运行上下文，未提交。后续需将必要的脱敏摘要与固定版本身份一起留档。

本轮发现旧源码断言仍在embedded-attempt主文件寻找工具投递参数。实际参数已位于embedded-attempt-session；仅修正检查路径，保留runDeliveryToolSideEffect、privateRunBag与持久副作用调度断言，未改变生产行为。

未合入main、未部署、未重启生产。已完成代码提交f4c5e2bbe并推至PR #250；其他团队observability文档与registry WIP保留。

— codex-runtime-manager

## 扩大矩阵与环境复核（后续）

- f4c5e2bbe 独立导出候选的 runtime/协作目录联合回归：297文件，2010 PASS / 22 FAIL。不能称整体全绿。
- 其中本机监听/tsx IPC EPERM 相关7项在允许临时本机端口的复跑后通过；9文件定向复跑为74 PASS / 14 FAIL。另一个投递源码路径断言已在dc5925e12改正，9项定向通过。不同批次不能简单合并为干净同SHA终验。
- 14项仍涉及：连续性ledger路径、R5/R6确认重复消费与唤醒、R7认领释放、待办ACL/确认人/修订、episode源码280字符截取断言、heartbeat escalate。尚未做父提交反证，不能全部称既有红或全部归因于本轮代码。
- PPT专用临时镜像安装超过15分钟无输出进展，apt-get处于D状态；对本轮构建PID及唯一命令核对后请求TERM停止，未重启或替换生产Gateway。原生PowerPoint UI打开自动化noWindowsAvailable/timeoutReached，未声称成功打开测试PPT。
- 飞书根据用户后续明确指令跳过；先前收到的应用密钥未写入仓库、报告或用于外发。
- 上线仍阻塞于上述未判清失败、PPT实物及GitHub CI账户计费。代码已推PR #250，未合入main、未部署。
