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
