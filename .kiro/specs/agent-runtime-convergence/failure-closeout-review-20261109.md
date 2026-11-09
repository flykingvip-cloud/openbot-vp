# 失败分类与结构说明核准

本轮基线 HEAD 为 57e74ceee250146c87b68ffd595f9eeda0228487，加现场 WIP 验证；不是已提交/部署版本。新鲜主干祖先门禁通过。

## 失败收口

- ContractEndedError 只在共享模型授权与命令授权适配中转换为明确 denied。共享模型侧原因保留 CONTRACT_ENDED，不混写为无订阅或模型失败。拒绝不启动候选、不持有租约、不释放未取得租约。未知存储/基础设施异常继续抛出，不全部伪装成商业拒绝。
- 沙箱缺少服务端 tenant/user 或账号绑定不匹配，按精确的现有错误语义识别；模型 fallback 原样终止，不消耗下一模型候选，不降低租户隔离、不改走主机或 personal fallback。
- admitted-turn 恢复出口将身份错误记为 prepareFailed/authz_denied，返回可解释的登录/绑定问题，不生成 capability gap，不将其说成模型预算耗尽。执行、验收、送达仍是独立事实，不合成 acceptance passed 或 delivery delivered。
- 红测：合同结束的 acquire promise 修前 rejected 而非 denied；缺身份修前运行两个候选。修后两项通过，其他未知准入异常仍抛出。联合8文件111 PASS；该计数不含真实模型/渠道。

## 结构说明修正

1. 目录不是线性上下级。command/execution/delivery 是业务三层；context/capabilities 是供给；policy/state 是公共机制；model 是共享推理基础；wiring 绑定明确端口。依赖合法性以有向依赖规则为准，不能笼统承诺所有依赖只能沿目录列表向下。
2. context 公开入口规则 runtime-context-reply-public-entry 仅覆盖 auto-reply。delivery/policy 等规则按清单覆盖，精确豁免不等于所有调用均受控。静态相对导入检查不能证明动态配置和所有别名路径。
3. 400行硬上限目前有例外：context/system-prompt.ts 966行，是后续完整提示投影迁入形成；不称全体实现均达标。保留字节摘要测试，后续按独立章节的职责抽取，不能为凑行数改变顺序或增加第二装配器。本轮不机械拆函数。
4. 兼容再导出允许指向唯一实现；禁止的是复制定义、隐式旧控制回退，而不是仅以旧文件存在判断双执行器。
5. 不能称原拆分从未引入行为差异。此前取消闭包丢失与preflight清理窗口已修复。当前显式状态类型仍逐阶段填充，构造有单一类型断言，不宣称完整 typestate 证明。

## 上线边界

真实模型、真实渠道、同构建跨重启主动投递、协作真实模型终局、PPT实物仍需验收；带桩111项不填这些格。CI账号计费阻塞与源码结果分别记录。未提交、未推送、未合并、未部署。

— codex-runtime-manager
