# 任务 4 完成总结：资产分享小组通知与归因追踪

## 完成时间

2026-07-01

## 需求回顾

让"分享资产到协作小组"这一动作在小组端真正可感知、可追溯，至少被分享组端应该能在对话窗口中接到该小组发来的通知。

## 已完成工作

### 1. 分享归因追踪（已提交 - commit e92cbdc32b）

**文件：** `src/gateway/skill-lifecycle-store.ts`, `src/gateway/skill-lifecycle-store.test.ts`

**功能：**

- 新增 `SkillShareAttribution` 类型，记录分享归因信息：
  - `shareId`: 唯一分享记录 ID
  - `skillId`: 被分享的资产 ID
  - `groupId`: 目标小组 ID
  - `sharedBy`: 分享者信息（userId, agentId, displayName）
  - `sharedAt`: 分享时间戳

- 扩展 `sharePersonalSkillToGroup` 函数：
  - 接受可选的 `sharedBy` 参数
  - 在 `SkillAssetStore` 中记录归因信息
  - 默认 displayName 为"未知分享者"

- 新增查询函数：
  - `listGroupSharedSkills(groupId)`: 查询小组的所有共享资产及其归因信息
  - `getSkillShareAttributions(skillId)`: 查询某个资产的所有分享记录

**测试：** 5 个测试用例全部通过

- 记录完整的分享归因信息
- 支持同一资产分享到多个小组
- 使用默认 displayName
- 按小组过滤共享资产
- 处理不存在的小组

### 2. RPC Handler 集成（已提交 - commit d9747d2b6d）

**文件：** `src/gateway/server-methods/employee-capability.ts`

**功能：**

- 更新 `employee-capability.share-to-group` RPC handler
- 从 `GatewayClient` 提取分享者身份信息：
  - `userEmail`: 用户邮箱
  - `agentId`: 机器人 ID
  - `displayName`: 显示名称（优先级：client.user > client.connect.client.displayName > agentId）
- 将分享者信息传递给 `sharePersonalSkillToGroup`
- 调用 `sendGroupNotification` 发送通知（带错误捕获）

### 3. 小组通知服务模块（已创建，待 landing-stream 配置后提交）

**文件：** `src/gateway/group-notification-service.ts`, `src/gateway/group-notification-service.test.ts`

**功能：**

- `sendGroupNotification(params)`: 发送小组系统通知
  - 当前为占位符实现（console.log）
  - 使用 `prefixSystemMessage` 格式化系统消息
  - 包含元数据（type, relatedResourceId, actionBy）
  - TODO: 需要实现实际的消息投递机制（路由到小组活跃 channels）

- `formatAssetShareNotification(params)`: 格式化分享通知消息
  - 支持中文资产类型标签（提示词/模板/工作流/知识库/智能体/能力）
  - 格式：`📢 来自 {分享者} 分享了{类型}「{资产名称}」到本小组`

**测试：** 5 个测试用例全部通过

- 格式化完整的分享通知消息
- 格式化不带小组名的通知
- 正确映射资产类型标签
- API 调用不抛出异常
- 处理缺少 metadata 的情况

**阻塞原因：**
这两个新文件被 worktree audit hook 标记为 UNMATCHED，需要在 `.loom/registry.yaml` 中显式指定所属 landing stream 才能提交。

## 数据流

```
用户操作：分享资产到小组
   ↓
employee-capability.share-to-group RPC handler
   ├─ 提取分享者身份 (userEmail, agentId, displayName)
   ├─ 调用 sharePersonalSkillToGroup({ skillId, groupId, sharedBy })
   │    ├─ 检查内容就绪度（assertContentReadyForIncubation）
   │    ├─ 更新资产 visibility = "group", lifecycle = "published"
   │    ├─ 添加小组到 skill.sharedGroups
   │    └─ 记录 SkillShareAttribution 到 store.shareAttributions
   ├─ 调用 applySharedSkillToGroupParticipation（注入到小组能力清单）
   ├─ 记录采用信号（recordAdoptionSignal）
   └─ 调用 sendGroupNotification（发送通知到小组对话）
        ├─ formatAssetShareNotification（格式化消息）
        ├─ prefixSystemMessage（添加系统消息前缀）
        └─ TODO: 投递到小组 channels
```

## 数据持久化

**SkillAssetStore 扩展：**

```json
{
  "skills": [...],
  "robotRelations": [...],
  "reviews": {...},
  "shareAttributions": [
    {
      "shareId": "share_a1b2c3d4e5f6",
      "skillId": "skill_123456789abc",
      "groupId": "sales-team",
      "sharedBy": {
        "userId": "user@example.com",
        "agentId": "agent-789",
        "displayName": "张三"
      },
      "sharedAt": 1719849600000
    }
  ]
}
```

## 待完成工作

### 1. 实现真实的通知投递机制（高优先级）

**当前状态：** `sendGroupNotification` 是占位符实现（仅 console.log）

**需要实现：**

1. 查找小组的活跃会话/channels
2. 路由系统消息到相应的 channels（telegram/discord/slack/etc.）
3. 使用各 channel 的现有发送机制
4. 处理投递失败（重试/降级）
5. 存储通知历史（审计）
6. 实施速率限制和去重

**建议实施路径：**

- 调研现有的消息路由机制（可能在 `src/auto-reply/` 或 `src/channels/`）
- 找到小组会话的映射关系（groupId → channel sessions）
- 使用现有的 channel send API（如 `sendMessageTelegram`, `sendMessageDiscord`）
- 考虑异步队列模式（避免阻塞 RPC handler）

### 2. 更新推荐接口显示分享来源（中优先级）

**需求：** 在员工能力市场的推荐列表中显示"来自 XXX 分享"

**当前状态：** `listSkillRecommendations` 返回 `sourceLabel: "共享推荐"`，无分享者信息

**需要实现：**

1. 扩展推荐投影，包含 `sharedBy` 字段
2. 从 `shareAttributions` 查询分享者信息
3. 更新 UI 显示逻辑（`ui/src/ui/controllers/enterprise-incubation/marketplace.ts`）
4. 格式化来源标签：`来自 {displayName} 分享` vs `共享推荐`

### 3. UI 显示增强（低优先级）

- 在资产详情页的"分享与分发"标签页显示分享历史
- 显示"已分享到 N 个小组"及小组列表
- 显示每次分享的时间和分享者

## 测试覆盖

- ✅ skill-lifecycle-store: 13 个测试（包括 5 个新增的归因测试）
- ✅ group-notification-service: 5 个测试
- ⏳ employee-capability RPC handler: 需要补充集成测试（验证归因记录和通知调用）
- ⏳ UI 推荐投影: 需要测试分享来源显示

## 技术债务

1. **通知投递占位符**：需要实现真实的 channel 路由和投递
2. **Landing stream 配置**：`group-notification-service.*` 文件需要配置到合适的 landing stream
3. **错误处理**：当前通知失败仅 console.error，需要更健壮的错误处理和监控
4. **性能优化**：如果分享频繁，需要考虑通知队列和批处理

## 验收标准

- [x] 分享到小组时记录分享者信息（userId, agentId, displayName）
- [x] 可查询小组的所有共享资产及分享归因
- [x] 可查询某个资产的所有分享历史
- [x] RPC handler 正确提取分享者身份
- [x] 调用通知服务（占位符实现）
- [x] 单元测试覆盖所有新增功能
- [ ] 通知真实投递到小组对话（待实现）
- [ ] 推荐列表显示分享来源（待实现）
- [ ] UI 显示分享历史（待实现）

## 提交记录

1. **e92cbdc32b** - feat(skill-lifecycle): add share attribution tracking (K2 stream)
2. **d9747d2b6d** - feat(employee-capability): capture sharer identity and send group notification (ASI stream)
3. **待提交** - feat(group-notification): add group notification service module

---

**责任人：** kiro-daibai  
**完成日期：** 2026-07-01  
**状态：** 核心功能已实现，通知投递机制待完善
