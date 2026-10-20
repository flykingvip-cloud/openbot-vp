package ai.openbot.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MeHubModelsTest {
  @Test
  fun parseAgentsList_mapsOwnedAndDefault() {
    val json =
      """
      {
        "defaultId": "main",
        "agents": [
          {"id": "main", "name": "默认管家", "identity": {"name": "默认管家", "emoji": "🤖"}},
          {"id": "a1", "name": "助手甲", "owned": true, "identity": {"emoji": "🧑‍💻", "role": "研发"}},
          {"id": "a2", "identity": {"name": "助手乙"}, "ownership": "shared"}
        ]
      }
      """.trimIndent()
    val rows = parseAgentsListAsMeBots(json)
    assertEquals(3, rows.size)
    assertEquals("main", rows[0].agentId)
    assertEquals(MeBotAccess.Owned, rows[0].access)
    assertEquals("可管理", meBotAccessBadge(rows[0].access))
    assertTrue(rows[0].isDefault)
    assertEquals(MeBotAccess.Owned, rows[1].access)
    assertEquals(MeBotAccess.Collab, rows[2].access)
    assertEquals("协作中", meBotAccessBadge(rows[2].access))
  }

  @Test
  fun parseSpaces_roleFromActor() {
    val json =
      """
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
      """.trimIndent()
    val rows = parseCollaborationSpacesAsMeGroups(json, setOf("ryan@upbeyond.ai"))
    assertEquals(2, rows.size)
    assertEquals("协作组A", rows[0].title)
    assertEquals(3, rows[0].memberCount)
    assertEquals("群主", rows[0].myRoleLabel)
    assertEquals("3 人 · 群主", meGroupSubtitle(rows[0]))
    assertEquals("成员", rows[1].myRoleLabel)
  }

  @Test
  fun parseOperationalIdentities_personalZone() {
    val json =
      """
      {
        "identities": [
          {
            "identityId": "id1",
            "provider": "wechat_personal",
            "providerLabel": "微信",
            "displayName": "张三",
            "status": "active",
            "grantCount": 1,
            "createdAt": "2026-01-01T00:00:00.000Z",
            "updatedAt": "2026-01-01T00:00:00.000Z"
          },
          {
            "identityId": "id2",
            "provider": "wecom",
            "providerLabel": "企业微信",
            "displayName": "销售岗",
            "status": "reauth_required",
            "grantCount": 0,
            "createdAt": "2026-01-01T00:00:00.000Z",
            "updatedAt": "2026-01-01T00:00:00.000Z"
          }
        ]
      }
      """.trimIndent()
    val rows = parseUserOperationalIdentities(json)
    assertEquals(2, rows.size)
    assertEquals(MeIdentityZone.Personal, rows[0].zone)
    assertEquals("微信 · 张三", rows[0].title)
    assertEquals("已绑定", rows[0].subtitle)
    assertEquals(MeIdentityZone.Enterprise, rows[1].zone)
    assertEquals("需重新授权", rows[1].subtitle)
  }

  @Test
  fun parseDevicePairList_readsPaired() {
    val json =
      """
      {
        "pending": [],
        "paired": [
          {"deviceId": "d1", "displayName": "Pixel", "platform": "android"},
          {"deviceId": "d2", "displayName": "Mac", "platform": "macos"}
        ]
      }
      """.trimIndent()
    val rows = parseDevicePairList(json, currentDeviceId = "d1")
    assertEquals(2, rows.size)
    assertTrue(rows[0].isCurrent)
    assertFalse(rows[1].isCurrent)
  }

  @Test
  fun identityCard_fromAccount() {
    val card = meIdentityCardFromAccount("ryan@upbeyond.ai", "org-1")
    assertEquals("ryan", card.displayName)
    assertEquals("ryan@upbeyond.ai", card.email)
    assertTrue(card.orgLine.contains("org-1"))
    assertEquals("R", card.avatarGlyph)
  }

  @Test
  fun buildParams_jsonShapes() {
    val identity = buildRobotIdentityUpdateParams("a1", "助手", "研发", "工程师", "严谨")
    assertTrue(identity.contains("\"agentId\":\"a1\""))
    assertTrue(identity.contains("\"name\":\"助手\""))
    val space = buildSpaceCreateParams("space-x", "小组", "👥", "同步")
    assertTrue(space.contains("\"groupId\":\"space-x\""))
    assertTrue(space.contains("discussion_driven"))
    val agent = buildAgentCreateParams("新人", "🤖", "~/.openbot/workspace/agents/x")
    assertTrue(agent.contains("\"name\":\"新人\""))
    assertTrue(agent.contains("\"workspace\":\"~/.openbot/workspace/agents/x\""))
    val models =
      parseEmployeeModelAccessSummary(
        """{"summary":{"modelIds":["openai/gpt-4o","anthropic/claude"],"state":"resolved","reason":"席位可用","seatId":"seat-1"}}""",
      )
    assertEquals(2, models.size)
    assertEquals(MeIdentityZone.Model, models[0].zone)
    assertTrue(models[0].title.contains("gpt-4o"))
    val invite = buildSpaceInviteHumanParams("g1", "小组", null, "a@b.c", "A")
    assertTrue(invite.contains("\"invites\""))
    assertTrue(invite.contains("a@b.c"))
    val members =
      parseCollaborationSpacesAsMeGroups(
        """{"spaces":[{"groupId":"g","title":"T","members":{"humans":[{"userId":"u1","name":"U"}],"bots":[{"agentId":"b1","name":"Bot"}]}}]}""",
        emptySet(),
      )
    assertEquals(2, members[0].members.size)
    assertEquals("U", members[0].members[0].name)
  }


  @Test
  fun parseRobotWorkspaceGet_mapsBlocks() {
    val json =
      """
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
      """.trimIndent()
    val detail = parseRobotWorkspaceGet(json)!!
    assertEquals("assistant-a", detail.agentId)
    assertEquals("助手甲", detail.name)
    assertEquals("可用", detail.statusLabel)
    assertEquals(2, detail.capabilities.size)
    assertEquals("个人", detail.capabilities[0].sourceLabel)
    assertEquals(2, detail.growth.level)
    assertEquals(1, detail.growth.gapCount)
    assertEquals("已起步", detail.growth.capabilityReadyLabel)
    assertEquals("协作组A", detail.collaborations[0].title)
    assertEquals("身份", meBotWorkspaceTabLabel(MeBotWorkspaceTab.Identity))
    assertEquals("运营授权", meBotWorkspaceTabLabel(MeBotWorkspaceTab.Auth))
  }

  @Test
  fun buildGrantUpsert_matchesWebShape() {
    val raw =
      buildRobotIdentityGrantUpsertParams(
        identityId = "id-gh",
        agentId = "bot-a",
        agentScope = "owned",
        allowedActions = listOf("create_issue"),
      )
    assertTrue(raw.contains("\"identityId\":\"id-gh\""))
    assertTrue(raw.contains("\"agentId\":\"bot-a\""))
    assertTrue(raw.contains("\"grantMode\":\"auto\""))
    assertTrue(raw.contains("\"confirmExplicit\":false"))
  }

}
