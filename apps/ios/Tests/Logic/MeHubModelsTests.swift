import Foundation
import Testing

struct MeHubModelsTests {
    @Test func `parse agents list maps owned and default`() {
        let json = """
        {
          "defaultId": "main",
          "agents": [
            {"id": "main", "name": "默认管家", "identity": {"name": "默认管家", "emoji": "🤖"}},
            {"id": "a1", "name": "助手甲", "owned": true, "identity": {"emoji": "🧑‍💻", "role": "研发"}},
            {"id": "a2", "identity": {"name": "助手乙"}, "ownership": "shared"}
          ]
        }
        """
        let rows = parseAgentsListAsMeBots(json)
        #expect(rows.count == 3)
        #expect(rows[0].agentId == "main")
        #expect(rows[0].access == .owned)
        #expect(meBotAccessBadge(rows[0].access) == "可管理")
        #expect(rows[0].isDefault)
        #expect(rows[1].access == .owned)
        #expect(rows[2].access == .collab)
        #expect(meBotAccessBadge(rows[2].access) == "协作中")
    }

    @Test func `parse spaces role from actor`() {
        let json = """
        {
          "spaces": [
            {
              "groupId": "space-a",
              "title": "协作组A",
              "ownerUserId": "ryan@upbeyond.ai",
              "ownerUserLabel": "Ryan",
              "coordinatorBotLabel": "默认管家",
              "members": {
                "humans": [{"userId": "ryan@upbeyond.ai"}, {"userId": "dana"}],
                "bots": [{"agentId": "main"}]
              }
            },
            {
              "id": "space-b",
              "title": "产品同步组",
              "ownerUserId": "dana",
              "members": {"humans": [{"userId": "dana"}], "bots": []}
            }
          ]
        }
        """
        let rows = parseCollaborationSpacesAsMeGroups(json, actorKeys: ["ryan@upbeyond.ai"])
        #expect(rows.count == 2)
        #expect(rows[0].title == "协作组A")
        #expect(rows[0].memberCount == 3)
        #expect(rows[0].myRoleLabel == "群主")
        #expect(meGroupSubtitle(rows[0]) == "3 人 · 群主")
        #expect(rows[1].myRoleLabel == "成员")
    }

    @Test func `parse operational identities personal zone`() {
        let json = """
        {
          "identities": [
            {
              "identityId": "id1",
              "provider": "wechat_personal",
              "providerLabel": "微信",
              "displayName": "张三",
              "status": "active"
            },
            {
              "identityId": "id2",
              "provider": "wecom",
              "providerLabel": "企业微信",
              "displayName": "销售岗",
              "status": "reauth_required"
            }
          ]
        }
        """
        let rows = parseUserOperationalIdentities(json)
        #expect(rows.count == 2)
        #expect(rows[0].zone == .personal)
        #expect(rows[0].title == "微信 · 张三")
        #expect(rows[0].subtitle == "已绑定")
        #expect(rows[1].zone == .enterprise)
        #expect(rows[1].subtitle == "需重新授权")
    }

    @Test func `parse device pair list reads paired`() {
        let json = """
        {
          "pending": [],
          "paired": [
            {"deviceId": "d1", "displayName": "Pixel", "platform": "android"},
            {"deviceId": "d2", "displayName": "Mac", "platform": "macos"}
          ]
        }
        """
        let rows = parseDevicePairList(json, currentDeviceId: "d1")
        #expect(rows.count == 2)
        #expect(rows[0].isCurrent)
        #expect(!rows[1].isCurrent)
        #expect(meDevicePairBadge(rows.count) == "2 台")
        #expect(meDevicePairBadge(0) == "—")
        #expect(meConnectBadge(connected: true) == "已连接")
        #expect(meConnectBadge(connected: false) == "未连接")
    }

    @Test func `identity card from account`() {
        let card = meIdentityCardFromAccount(email: "ryan@upbeyond.ai", orgId: "org-1")
        #expect(card.displayName == "ryan")
        #expect(card.email == "ryan@upbeyond.ai")
        #expect(card.orgLine.contains("org-1"))
        #expect(card.avatarGlyph == "R")
        #expect(meGatewayIsConnected(statusText: "Connected", serverName: "gw"))
        #expect(!meGatewayIsConnected(statusText: "Disconnected: x", serverName: nil))
        #expect(!meGatewayIsConnected(statusText: "Connected", serverName: nil))
    }

    @Test func `build params json shapes`() {
        let identity = buildRobotIdentityUpdateParams(
            agentId: "a1",
            name: "助手",
            positioning: "研发",
            role: "工程师",
            personaTraits: "严谨")
        #expect(identity.contains("\"agentId\":\"a1\""))
        #expect(identity.contains("\"name\":\"助手\""))
        let space = buildSpaceCreateParams(groupId: "space-x", title: "小组", avatar: "👥", purpose: "同步")
        #expect(space.contains("\"groupId\":\"space-x\""))
        #expect(space.contains("discussion_driven"))
        let agent = buildAgentCreateParams(name: "新人", emoji: "🤖", workspace: "~/.openbot/workspace/agents/x")
        #expect(agent.contains("\"name\":\"新人\""))
        #expect(agent.contains("\"workspace\":\"~/.openbot/workspace/agents/x\""))
        let models = parseEmployeeModelAccessSummary(
            #"{"summary":{"modelIds":["openai/gpt-4o","anthropic/claude"],"state":"resolved","reason":"席位可用","seatId":"seat-1"}}"#)
        #expect(models.count == 2)
        #expect(models[0].zone == .model)
        #expect(models[0].title.contains("gpt-4o"))
        let invite = buildSpaceInviteHumanParams(
            groupId: "g1",
            title: "小组",
            purpose: nil,
            inviteUserId: "a@b.c",
            inviteName: "A")
        #expect(invite.contains("\"invites\""))
        #expect(invite.contains("a@b.c"))
        let members = parseCollaborationSpacesAsMeGroups(
            #"{"spaces":[{"groupId":"g","title":"T","members":{"humans":[{"userId":"u1","name":"U"}],"bots":[{"agentId":"b1","name":"Bot"}]}}]}"#,
            actorKeys: [])
        #expect(members[0].members.count == 2)
        #expect(members[0].members[0].name == "U")
    }

    @Test func `parse robot workspace get maps blocks`() {
        let json = """
        {
          "bot": {
            "agentId": "assistant-a",
            "identity": {
              "name": "助手甲",
              "positioning": "研发助手",
              "role": "研发助手",
              "personaTraits": "专业严谨",
              "model": "GPT-4.1",
              "status": "online"
            },
            "capabilities": [
              {"name": "会议纪要", "stars": 4, "source": "personal"},
              {"name": "代码评审", "stars": 3, "source": "enterprise"}
            ],
            "personas": [{"id": "p1", "label": "研发助手", "description": "专业严谨"}],
            "growth": {
              "level": 2,
              "activationScore": 64,
              "operationalScore": null,
              "capabilityGaps": [{"key": "x", "label": "缺口", "kind": "skill", "status": "missing"}],
              "funnel": {"hasFirstSkillInstalled": true}
            },
            "collaborations": [
              {"groupId": "space-a", "title": "协作组A", "sessionKey": "space:space-a"}
            ]
          }
        }
        """
        let detail = parseRobotWorkspaceGet(json)
        #expect(detail?.agentId == "assistant-a")
        #expect(detail?.name == "助手甲")
        #expect(detail?.statusLabel == "可用")
        #expect(detail?.capabilities.count == 2)
        #expect(detail?.capabilities[0].sourceLabel == "个人")
        #expect(detail?.growth.level == 2)
        #expect(detail?.growth.gapCount == 1)
        #expect(detail?.growth.capabilityReadyLabel == "已起步")
        #expect(detail?.collaborations[0].title == "协作组A")
        #expect(meBotWorkspaceTabLabel(.identity) == "身份")
        #expect(meBotWorkspaceTabLabel(.auth) == "运营授权")
    }

    @Test func `build grant upsert matches web shape`() {
        let raw = buildRobotIdentityGrantUpsertParams(
            identityId: "id-gh",
            agentId: "bot-a",
            agentScope: "owned",
            allowedActions: ["create_issue"])
        #expect(raw.contains("\"identityId\":\"id-gh\""))
        #expect(raw.contains("\"agentId\":\"bot-a\""))
        #expect(raw.contains("\"grantMode\":\"auto\""))
        #expect(raw.contains("\"confirmExplicit\":false"))
        let local = buildWorkspaceCreateLocalParams(name: "新人", agentSlug: "xinren")
        #expect(local.contains("~/.openbot/workspace/agents/xinren"))
        #expect(slugifyMeEntityId(prefix: "space", title: "产品 同步") == "space-产品-同步")
        #expect(meHubRouteTitle(.devices, bots: [], groups: []) == "我的设备")
    }
}
