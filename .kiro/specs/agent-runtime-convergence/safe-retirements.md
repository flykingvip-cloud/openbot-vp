# 本次迁移兼容入口消费者核实与安全退役建议

只读基线 `10ae0b5af7bea5735abcade4bcd6a58ab5d4eddb`，专用runtime-convergence树。未编辑、未提交。范围覆盖全repo普通与hidden检索、测试、scripts、SDK入口、package exports、tsdown、字符串引用；排除.git/node_modules/dist/构建缓存。源码外任意用户深导入不可证明不存在，但下列均非package exports公开入口。

## 可直接安全退役候选

| 文件                                        | 真实消费者                                                                                                                 | 处理建议                                                   | 验收                                                                              |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/auto-reply/reply/untrusted-context.ts` | 无代码/测试import；get-reply-run已直引runtime/context/untrusted。剩余仅loom路径登记、历史规范文字及CHANGELOG中的非路径术语 | 删除纯reexport。更新当前迁移文档，历史审计记录不为清零强删 | 全repo旧文件路径无代码import；context untrusted + get-reply-run相关测试；架构检查 |

## 完成消费者迁移后可删（当前不可直接删）

| 文件                                                       | 消费者证据                                                                                                                                  | 最小退役步骤                                                                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agents/execution-stall-continue-loop.ts`              | `execution-stall-continue-loop.test.ts:2`；`pi-embedded-runner/run/attempt.test.ts:6`。生产attempt已通过runtime/execution/index使用唯一实现 | 两处测试改公开runtime接口；保留既有协议/取消测试，不删覆盖；再删旧reexport。历史文件名不等于必须改测试标题                            |
| `src/auto-reply/reply/agent-runner-payloads.ts`            | `agent-runner-payloads.test.ts:2`；生产agent-runner已直引runtime/delivery/index                                                             | 测试改公开delivery接口，确认异步契约不变后删reexport。测试文件可保留名字以减少无关搬动                                                |
| `inbound-text.ts`中的normalizeInboundTextNewlines reexport | reply-flow.test、inbound-context.ts、session.ts、auto-reply/inbound.test仍消费                                                              | 仅迁该symbol到shared/text/normalize-newlines；文件还实现sanitizeInboundSystemTags，不能整文件删除                                     |
| `mid-task-aside-dialogue-history.ts` budget reexports      | mid-task-aside-reply-lane.ts reexport及其测试消费常量/select函数；自身生产函数也从runtime/context导入预算                                   | 将外部预算消费者直引runtime/context/aside-budget或受控public接口；保留history读取/合并/信任包装实现，不删整个文件。对外类型引用要同步 |

## SDK/动态入口核实

- package.json公开exports为plugin-sdk子入口等，未声明上述旧内部模块路径。
- tsdown.config.ts显式entry为核心入口、渠道动作、plugin-sdk入口、extensionAPI及hooks glob，没有给上述旧兼容文件独立构建入口。
- src/plugin-sdk与scripts内检索旧文件路径无匹配；本次未发现字符串动态import旧模块。
- .loom registry/landing paths中的匹配是归属证据，不是消费者；可按任务完成后管理，不当运行依赖。
- 不把dist中旧产物当源码引用；构建验证应干净产物或记录增量清理，避免文件删除后陈旧dist误导。

## 非本轮可直接退役

hooks handler/transform、插件service、Lobster、OpenProse、BOOT、CLI backend均需要有效配置、已加载快照、消费者及持久资产证据。不得因“架构需要单主线”直接删除。

### 仍阻塞整体收敛完成的未知项

1. 有效部署启用的hooks/transform/plugin/service清单、模块来源与控制权限。源码默认不是生产事实。
2. Lobster未完成resumeToken/pipeline用户资产；OpenProse程序、VM状态与子会话消费者。
3. task-orchestration默认只读invoke的真实调用范围、预算与授权，以及与任务主线的控制层级；四开关默认关不能证明无执行。
4. 会话任务板、协作todolist、task-outcome等记录的权威边界是否全部完成审定；不能仅目录迁移就宣称计划权唯一。
5. 同一规则在剩余agent-runner/get-reply-run/gateway中的判断是否已经形成唯一实现；纯reexport删除不等于重复控制全部清理。
6. 外部私有插件或运维脚本若深导入内部文件，需要部署方搜索；无package公开承诺可作为源码退役依据，但发布记录应说明内部路径变更。

## 执行门禁

安全删除只能删除旧接口壳，不删除测试覆盖，不变更常量/算法/预算，不触及授权/取消。一次绿色检查点：迁测试消费者→删壳→全repo残留检索→相关测试+架构检查→必要构建。不得顺带整库格式化或改hooks。

材料贡献 runtime-extension-audit；只读完毕。
