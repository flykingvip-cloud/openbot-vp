package ai.openbot.app.ui

import java.util.Locale
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.add
import kotlinx.serialization.json.putJsonObject

/**
 * Web-aligned Me hub models — mirrors personal settings / devices / my-bots / collab spaces.
 *
 * Personal / auth:
 * - `user-operational-identity.list` (workbench-personal-authorization-panel)
 * - enterprise seat identities via `enterprise-operational-identity.access.list-for-seat`
 *
 * Devices:
 * - `device.pair.list` (ui/src/ui/controllers/devices.ts)
 *
 * 我的机器人:
 * - `agents.list` + `robot.workspace.get` / `robot.workspace.updateIdentity`
 *   (my-bot-read-model / my-bot-workspace-panel tabs:
 *   身份|能力|成长|运营授权|协作)
 * - 运营授权 grants: `user-operational-identity.access.list-for-agent` +
 *   `user-operational-identity.grants.upsert`
 *
 * 我的协作小组:
 * - `collaboration.spaces.list` + `collaboration.spaces.members.update` create
 *   (spaces.ts / collaboration-group-read-model)
 */
private val meJson = Json { ignoreUnknownKeys = true }

const val DEMO_ME_EXTRA = "ai.openbot.app.extra.DEMO_ME"

enum class MeHubSegment {
  Account,
  Device,
  More,
}

enum class MeBotAccess {
  Owned,
  Collab,
}

/** Web `MyBotDetailTabId` — first five product tabs (omit data/danger on phone SoT). */
enum class MeBotWorkspaceTab {
  Identity,
  Capabilities,
  Growth,
  Auth,
  Collaboration,
}

data class MeBotCapabilityRow(
  val name: String,
  val stars: Int,
  val sourceLabel: String,
)

data class MeBotPersonaRow(
  val id: String,
  val label: String,
  val description: String? = null,
)

data class MeBotCollabRow(
  val groupId: String,
  val title: String,
  val sessionKey: String? = null,
)

data class MeBotGrowthSummary(
  val level: Int = 0,
  val activationScore: Int? = null,
  val operationalScore: Int? = null,
  val gapCount: Int = 0,
  val capabilityReadyLabel: String = "—",
)

data class MeBotAuthGrantRow(
  val identityId: String,
  val title: String,
  val subtitle: String,
  val kind: String, // personal | enterprise
  val enrolled: Boolean,
  val enabled: Boolean = true,
)

/** Projection from `robot.workspace.get` → `{ bot }` (Web MyBotProjection). */
data class MeBotWorkspaceDetail(
  val agentId: String,
  val name: String,
  val positioning: String? = null,
  val role: String? = null,
  val personaTraits: String? = null,
  val model: String? = null,
  val statusLabel: String = "可用",
  val capabilities: List<MeBotCapabilityRow> = emptyList(),
  val personas: List<MeBotPersonaRow> = emptyList(),
  val growth: MeBotGrowthSummary = MeBotGrowthSummary(),
  val collaborations: List<MeBotCollabRow> = emptyList(),
)

enum class MeIdentityZone {
  Personal,
  Enterprise,
  Model,
}

data class MeIdentityCardState(
  val displayName: String,
  val email: String,
  val orgLine: String,
  val avatarGlyph: String,
)

data class MeAuthResourceRow(
  val id: String,
  val title: String,
  val subtitle: String,
  val zone: MeIdentityZone,
  val provider: String? = null,
  val status: String? = null,
)

data class MeBotRow(
  val agentId: String,
  val name: String,
  val emoji: String?,
  val access: MeBotAccess,
  val subtitle: String,
  val positioning: String? = null,
  val persona: String? = null,
  val roleTitle: String? = null,
  val isDefault: Boolean = false,
)

data class MeGroupMemberRow(
  val id: String,
  val name: String,
  val kind: String, // human | bot
  val roleHint: String? = null,
)

data class MeGroupRow(
  val groupId: String,
  val title: String,
  val avatar: String?,
  val memberCount: Int,
  val myRoleLabel: String,
  val ownerLabel: String?,
  val coordinatorBotLabel: String?,
  val purpose: String? = null,
  val members: List<MeGroupMemberRow> = emptyList(),
)

data class MePairedDeviceRow(
  val deviceId: String,
  val displayName: String,
  val platform: String?,
  val isCurrent: Boolean = false,
)

fun meBotAccessBadge(access: MeBotAccess): String =
  when (access) {
    MeBotAccess.Owned -> "可管理"
    MeBotAccess.Collab -> "协作中"
  }

fun meGroupSubtitle(row: MeGroupRow): String {
  val n = row.memberCount.coerceAtLeast(0)
  return "$n 人 · ${row.myRoleLabel}"
}

fun meIdentityCardFromAccount(
  email: String?,
  orgId: String?,
  displayNameHint: String? = null,
): MeIdentityCardState {
  val trimmedEmail = email?.trim().orEmpty()
  val name =
    displayNameHint?.trim()?.takeIf { it.isNotEmpty() }
      ?: trimmedEmail.substringBefore("@").takeIf { it.isNotEmpty() }
      ?: "未登录员工账号"
  val glyph =
    name.firstOrNull { !it.isWhitespace() }?.uppercaseChar()?.toString() ?: "·"
  val orgLine =
    when {
      orgId.isNullOrBlank() && trimmedEmail.isEmpty() -> "登录后同步身份"
      orgId.isNullOrBlank() -> "个人账号"
      else -> "组织 $orgId"
    }
  return MeIdentityCardState(
    displayName = if (trimmedEmail.isEmpty() && displayNameHint.isNullOrBlank()) "未登录员工账号" else name,
    email = trimmedEmail.ifEmpty { "—" },
    orgLine = orgLine,
    avatarGlyph = glyph,
  )
}

fun parseAgentsListAsMeBots(raw: String): List<MeBotRow> {
  val root = meJson.parseToJsonElement(raw).asObj() ?: return emptyList()
  val defaultId = root.str("defaultId").orEmpty()
  val agents = root.arr("agents") ?: return emptyList()
  return agents.mapNotNull { el ->
    val obj = el.asObj() ?: return@mapNotNull null
    val id = obj.str("id") ?: return@mapNotNull null
    val identity = obj.obj("identity")
    val name =
      obj.str("name")
        ?: identity?.str("name")
        ?: id
    val emoji = identity?.str("emoji") ?: obj.str("emoji")
    val isDefault = id == defaultId || (defaultId.isEmpty() && id == "main")
    val ownedHint =
      obj.bool("isOwner")
        ?: obj.bool("owned")
        ?: obj.str("ownership")?.equals("owned", ignoreCase = true)
        ?: isDefault
    val access = if (ownedHint == true) MeBotAccess.Owned else MeBotAccess.Collab
    // Default steward is always 可管理 in employee SoT.
    val resolvedAccess = if (isDefault) MeBotAccess.Owned else access
    MeBotRow(
      agentId = id,
      name = name,
      emoji = emoji,
      access = resolvedAccess,
      subtitle = if (isDefault) "固定首位管家" else "可用",
      positioning = identity?.str("theme") ?: identity?.str("positioning"),
      persona = identity?.str("persona") ?: identity?.str("personaTraits"),
      roleTitle = identity?.str("role") ?: identity?.str("roleTitle"),
      isDefault = isDefault,
    )
  }
}

fun parseCollaborationSpacesAsMeGroups(
  raw: String,
  actorKeys: Set<String> = emptySet(),
): List<MeGroupRow> {
  val root = meJson.parseToJsonElement(raw).asObj() ?: return emptyList()
  val spaces = root.arr("spaces") ?: return emptyList()
  val actors = actorKeys.map { it.trim().lowercase(Locale.ROOT) }.filter { it.isNotEmpty() }.toSet()
  return spaces.mapNotNull { el ->
    val obj = el.asObj() ?: return@mapNotNull null
    val groupId =
      obj.str("groupId")
        ?: obj.str("id")
        ?: return@mapNotNull null
    val title = obj.str("title") ?: obj.str("name") ?: groupId
    val avatar = obj.str("avatar")
    val purpose = obj.str("purpose")
    val ownerUserId =
      obj.str("ownerUserId")
        ?: obj.obj("operatingState")?.obj("governance")?.str("ownerUserId")
    val ownerLabel =
      obj.str("ownerUserLabel")
        ?: obj.str("ownerLabel")
        ?: ownerUserId
    val coordinator =
      obj.str("coordinatorBotLabel")
        ?: obj.str("coordinatorBotId")
    val membersObj = obj.obj("members")
    val humanEls = membersObj?.arr("humans").orEmpty()
    val botEls = membersObj?.arr("bots").orEmpty()
    val roster = buildList {
      for (el in humanEls) {
        val m = el.asObj() ?: continue
        val id = m.str("userId") ?: m.str("id") ?: continue
        val name = m.str("name") ?: m.str("handle") ?: id
        add(MeGroupMemberRow(id = id, name = name, kind = "human"))
      }
      for (el in botEls) {
        val m = el.asObj() ?: continue
        val id = m.str("agentId") ?: m.str("id") ?: continue
        val name = m.str("name") ?: id
        add(MeGroupMemberRow(id = id, name = name, kind = "bot"))
      }
    }
    val memberCount =
      when {
        roster.isNotEmpty() -> roster.size
        else ->
          obj.int("memberCount")
            ?: obj.arr("memberIds")?.size
            ?: 0
      }
    val ownerIsActor =
      ownerUserId?.trim()?.lowercase(Locale.ROOT)?.let { actors.contains(it) } == true
    val roleLabel =
      when {
        actors.isEmpty() -> "成员"
        ownerIsActor -> "群主"
        else -> "成员"
      }
    MeGroupRow(
      groupId = groupId.removePrefix("space:"),
      title = title,
      avatar = avatar,
      memberCount = memberCount,
      myRoleLabel = roleLabel,
      ownerLabel = ownerLabel,
      coordinatorBotLabel = coordinator,
      purpose = purpose,
      members = roster,
    )
  }
}

fun parseUserOperationalIdentities(raw: String): List<MeAuthResourceRow> {
  val root = meJson.parseToJsonElement(raw).asObj() ?: return emptyList()
  val identities = root.arr("identities") ?: emptyList()
  return identities.mapNotNull { el ->
    val obj = el.asObj() ?: return@mapNotNull null
    val id = obj.str("identityId") ?: return@mapNotNull null
    val provider = obj.str("provider").orEmpty()
    val label = obj.str("providerLabel") ?: provider
    val display = obj.str("displayName").orEmpty()
    val status = obj.str("status").orEmpty()
    val statusLabel =
      when (status.lowercase(Locale.ROOT)) {
        "active" -> "已绑定"
        "expired" -> "已过期"
        "reauth_required" -> "需重新授权"
        "revoked" -> "已撤销"
        else -> status.ifBlank { "—" }
      }
    val zone =
      if (provider.contains("enterprise", ignoreCase = true) ||
        provider.contains("wecom", ignoreCase = true) ||
        provider.contains("dingtalk", ignoreCase = true)
      ) {
        MeIdentityZone.Enterprise
      } else {
        MeIdentityZone.Personal
      }
    MeAuthResourceRow(
      id = id,
      title = if (display.isNotEmpty()) "$label · $display" else label,
      subtitle = statusLabel,
      zone = zone,
      provider = provider,
      status = status,
    )
  }
}

fun parseEnterpriseSeatIdentities(raw: String): List<MeAuthResourceRow> {
  val root = meJson.parseToJsonElement(raw).asObj() ?: return emptyList()
  // list-for-seat may return { identities: [...] } or a bare array under various keys.
  val list =
    root.arr("identities")
      ?: root.arr("entries")
      ?: root.arr("items")
      ?: emptyList()
  return list.mapNotNull { el ->
    val obj = el.asObj() ?: return@mapNotNull null
    val id =
      obj.str("identityId")
        ?: obj.str("id")
        ?: return@mapNotNull null
    val title =
      obj.str("label")
        ?: obj.str("displayName")
        ?: obj.str("providerLabel")
        ?: id
    val subtitle =
      obj.str("seatTitle")
        ?: obj.str("status")
        ?: "企业身份"
    MeAuthResourceRow(
      id = id,
      title = title,
      subtitle = subtitle,
      zone = MeIdentityZone.Enterprise,
      provider = obj.str("provider"),
      status = obj.str("status"),
    )
  }
}

fun parseDevicePairList(raw: String, currentDeviceId: String? = null): List<MePairedDeviceRow> {
  val root = meJson.parseToJsonElement(raw).asObj() ?: return emptyList()
  val paired = root.arr("paired") ?: return emptyList()
  val current = currentDeviceId?.trim().orEmpty()
  return paired.mapNotNull { el ->
    val obj = el.asObj() ?: return@mapNotNull null
    val id = obj.str("deviceId") ?: return@mapNotNull null
    MePairedDeviceRow(
      deviceId = id,
      displayName = obj.str("displayName") ?: id.take(8),
      platform = obj.str("platform") ?: obj.str("deviceFamily"),
      isCurrent = current.isNotEmpty() && id == current,
    )
  }
}

fun meBotWorkspaceTabLabel(tab: MeBotWorkspaceTab): String =
  when (tab) {
    MeBotWorkspaceTab.Identity -> "身份"
    MeBotWorkspaceTab.Capabilities -> "能力"
    MeBotWorkspaceTab.Growth -> "成长"
    MeBotWorkspaceTab.Auth -> "运营授权"
    MeBotWorkspaceTab.Collaboration -> "协作"
  }

fun capabilitySourceLabel(source: String?): String =
  when (source?.lowercase(Locale.ROOT)) {
    "personal" -> "个人"
    "group" -> "小组"
    "enterprise" -> "企业"
    "marketplace" -> "市场"
    else -> source?.ifBlank { "—" } ?: "—"
  }

fun parseRobotWorkspaceGet(raw: String): MeBotWorkspaceDetail? {
  val root = meJson.parseToJsonElement(raw).asObj() ?: return null
  val bot = root.obj("bot") ?: root
  val agentId = bot.str("agentId") ?: return null
  val identity = bot.obj("identity")
  val name =
    identity?.str("name")
      ?: bot.str("name")
      ?: agentId
  val status =
    when (identity?.str("status")?.lowercase(Locale.ROOT)) {
      "online" -> "可用"
      "degraded" -> "异常"
      "offline" -> "离线"
      else -> "未知"
    }
  val caps =
    (bot.arr("capabilities") ?: emptyList()).mapNotNull { el ->
      val o = el.asObj() ?: return@mapNotNull null
      val capName = o.str("name") ?: return@mapNotNull null
      MeBotCapabilityRow(
        name = capName,
        stars = (o.int("stars") ?: 0).coerceIn(0, 5),
        sourceLabel = capabilitySourceLabel(o.str("source")),
      )
    }
  val personas =
    (bot.arr("personas") ?: emptyList()).mapNotNull { el ->
      val o = el.asObj() ?: return@mapNotNull null
      val id = o.str("id") ?: return@mapNotNull null
      MeBotPersonaRow(
        id = id,
        label = o.str("label") ?: id,
        description = o.str("description"),
      )
    }
  val growthObj = bot.obj("growth")
  val gaps = growthObj?.arr("capabilityGaps") ?: emptyList()
  val unmet =
    gaps.count { el ->
      el.asObj()?.str("status")?.equals("missing", ignoreCase = true) == true
    }
  val funnel = growthObj?.obj("funnel")
  val capabilityReady =
    when {
      funnel?.bool("hasFirstSkillInstalled") == true -> "已起步"
      else -> "待安装"
    }
  val growth =
    MeBotGrowthSummary(
      level = growthObj?.int("level") ?: 0,
      activationScore = growthObj?.int("activationScore"),
      operationalScore = growthObj?.int("operationalScore"),
      gapCount = unmet,
      capabilityReadyLabel = capabilityReady,
    )
  val collabs =
    (bot.arr("collaborations") ?: emptyList()).mapNotNull { el ->
      val o = el.asObj() ?: return@mapNotNull null
      val gid = o.str("groupId") ?: return@mapNotNull null
      MeBotCollabRow(
        groupId = gid,
        title = o.str("title") ?: gid,
        sessionKey = o.str("sessionKey"),
      )
    }
  return MeBotWorkspaceDetail(
    agentId = agentId,
    name = name,
    positioning = identity?.str("positioning"),
    role = identity?.str("role"),
    personaTraits = identity?.str("personaTraits"),
    model = identity?.str("model"),
    statusLabel = status,
    capabilities = caps,
    personas = personas,
    growth = growth,
    collaborations = collabs,
  )
}

fun parseAgentAccessListForGrants(raw: String): List<MeBotAuthGrantRow> {
  val root = meJson.parseToJsonElement(raw).asObj() ?: return emptyList()
  val list =
    root.arr("identities")
      ?: root.arr("grants")
      ?: root.arr("entries")
      ?: root.arr("items")
      ?: emptyList()
  return list.mapNotNull { el ->
    val o = el.asObj() ?: return@mapNotNull null
    val id = o.str("identityId") ?: o.str("id") ?: return@mapNotNull null
    val title =
      o.str("displayName")
        ?: o.str("providerLabel")
        ?: o.str("label")
        ?: id
    val subtitle =
      o.str("providerLabel")
        ?: o.str("status")
        ?: "—"
    val kind =
      when {
        o.str("kind")?.contains("enterprise", ignoreCase = true) == true -> "enterprise"
        o.bool("enterprise") == true -> "enterprise"
        else -> "personal"
      }
    val enrolled =
      o.bool("enrolled")
        ?: o.bool("granted")
        ?: o.str("status")?.equals("active", ignoreCase = true)
        ?: false
    MeBotAuthGrantRow(
      identityId = id,
      title = title,
      subtitle = subtitle,
      kind = kind,
      enrolled = enrolled == true,
      enabled = o.str("status")?.equals("active", ignoreCase = true) != false,
    )
  }
}

/** One call per grant — mirrors Web `user-operational-identity.grants.upsert`. */
fun buildRobotIdentityGrantUpsertParams(
  identityId: String,
  agentId: String,
  agentScope: String,
  allowedActions: List<String> = listOf("*"),
): String =
  buildJsonObject {
    put("identityId", identityId)
    put("agentId", agentId)
    put("agentScope", agentScope)
    putJsonArray("allowedActions") {
      for (a in allowedActions) add(a)
    }
    put("grantMode", if (agentScope == "owned") "auto" else "explicit")
    put("confirmExplicit", agentScope != "owned")
  }.toString()

fun buildRobotIdentityUpdateParams(
  agentId: String,
  name: String,
  positioning: String?,
  role: String?,
  personaTraits: String?,
): String =
  buildJsonObject {
    put("agentId", agentId)
    putJsonObject("identity") {
      put("name", name)
      if (!positioning.isNullOrBlank()) put("positioning", positioning)
      if (!role.isNullOrBlank()) put("role", role)
      if (!personaTraits.isNullOrBlank()) put("personaTraits", personaTraits)
    }
  }.toString()

fun buildSpaceCreateParams(
  groupId: String,
  title: String,
  avatar: String?,
  purpose: String?,
): String =
  buildJsonObject {
    put("groupId", groupId)
    put("title", title)
    if (!avatar.isNullOrBlank()) put("avatar", avatar)
    if (!purpose.isNullOrBlank()) put("purpose", purpose)
    put("collaborationMode", "discussion_driven")
    putJsonObject("members") {
      putJsonArray("humans") {}
      putJsonArray("bots") {}
    }
  }.toString()

/**
 * Invite a human into an existing space via Web `collaboration.spaces.members.update`
 * `invites.humans` (spaces.ts WorkbenchSpaceMembersUpdateParams).
 */
fun buildSpaceInviteHumanParams(
  groupId: String,
  title: String,
  purpose: String?,
  inviteUserId: String,
  inviteName: String? = null,
): String =
  buildJsonObject {
    put("groupId", groupId)
    put("title", title)
    if (!purpose.isNullOrBlank()) put("purpose", purpose)
    putJsonObject("members") {
      putJsonArray("humans") {}
      putJsonArray("bots") {}
    }
    putJsonObject("invites") {
      putJsonArray("humans") {
        add(
          buildJsonObject {
            put("userId", inviteUserId.trim())
            if (!inviteName.isNullOrBlank()) put("name", inviteName.trim())
          },
        )
      }
      putJsonArray("bots") {}
    }
  }.toString()

/** Managed local workspace root used by Web `render-model-workbench-actions` when managed. */
const val ME_MANAGED_WORKSPACE_ROOT = "~/.openbot/workspace"

fun buildWorkspaceCreateLocalParams(name: String, agentSlug: String): String {
  val path = "$ME_MANAGED_WORKSPACE_ROOT/agents/${agentSlug.trim().ifEmpty { "agent" }}"
  return buildJsonObject {
    put("name", "$name Workspace")
    put("kind", "local")
    putJsonObject("local") { put("path", path) }
  }.toString()
}

fun parseWorkspaceCreateResult(raw: String): Pair<String?, String?> {
  val root = meJson.parseToJsonElement(raw).asObj() ?: return null to null
  return root.str("workspaceId") to root.str("runtimePath")
}

fun parseAgentCreateResult(raw: String): String? {
  val root = meJson.parseToJsonElement(raw).asObj() ?: return null
  return root.str("agentId")
}

/**
 * Web create path: `workspaces.create` → `agents.create` (workspace required) →
 * optional `robots.bind-workspace`.
 */
fun buildAgentCreateParams(name: String, emoji: String?, workspace: String): String =
  buildJsonObject {
    put("name", name)
    put("workspace", workspace)
    if (!emoji.isNullOrBlank()) put("emoji", emoji)
  }.toString()

fun buildRobotBindWorkspaceParams(agentId: String, workspaceId: String): String =
  buildJsonObject {
    put("agentId", agentId)
    put("workspaceId", workspaceId)
  }.toString()

/**
 * Parse `employee-model-access.summary` → 可用模型 rows
 * (Web `employee-model-access-section` / MODEL_AUTHORIZATION_ENDPOINTS.employeeSummary).
 */
fun parseEmployeeModelAccessSummary(raw: String): List<MeAuthResourceRow> {
  val root = meJson.parseToJsonElement(raw).asObj() ?: return emptyList()
  val summary = root.obj("summary") ?: root
  val state = summary.str("state").orEmpty()
  val reason = summary.str("reason").orEmpty()
  val seatId = summary.str("seatId")
  val models = summary.arr("modelIds").orEmpty()
  if (models.isEmpty()) {
    val subtitle =
      when {
        reason.isNotBlank() -> reason
        state == "missing" -> "当前账号未绑定企业席位，暂无模型授权信息"
        else -> "暂无可用模型"
      }
    return listOf(
      MeAuthResourceRow(
        id = "model-empty",
        title = "可用模型",
        subtitle = subtitle,
        zone = MeIdentityZone.Model,
        status = state.ifBlank { null },
      ),
    )
  }
  return models.mapIndexed { index, el ->
    val id =
      when (el) {
        is JsonPrimitive -> el.contentOrNull?.trim().orEmpty()
        is JsonObject -> el.str("id") ?: el.str("modelId") ?: el.str("model").orEmpty()
        else -> ""
      }.ifBlank { "model-$index" }
    val title =
      when (el) {
        is JsonObject -> el.str("label") ?: el.str("name") ?: id
        else -> id
      }
    MeAuthResourceRow(
      id = id,
      title = title,
      subtitle =
        buildString {
          append("席位可用")
          if (!seatId.isNullOrBlank()) append(" · seat $seatId")
          if (reason.isNotBlank() && index == 0) append(" · $reason")
        },
      zone = MeIdentityZone.Model,
      status = state.ifBlank { "resolved" },
    )
  }
}

fun slugifyMeEntityId(prefix: String, title: String): String {
  val slug =
    title
      .trim()
      .lowercase(Locale.ROOT)
      .replace(Regex("[^a-z0-9\\u4e00-\\u9fff]+"), "-")
      .trim('-')
      .take(32)
      .ifEmpty { "item" }
  return "$prefix-$slug"
}

fun demoMeBotWorkspace(bot: MeBotRow): MeBotWorkspaceDetail {
  val owned = bot.access == MeBotAccess.Owned
  return MeBotWorkspaceDetail(
    agentId = bot.agentId,
    name = bot.name,
    positioning = bot.positioning,
    role = bot.roleTitle,
    personaTraits = bot.persona,
    model = "GPT-4.1",
    statusLabel = "可用",
    capabilities =
      if (owned) {
        listOf(
          MeBotCapabilityRow("会议纪要", 4, "个人"),
          MeBotCapabilityRow("代码评审", 3, "企业"),
        )
      } else {
        listOf(MeBotCapabilityRow("导航指引", 3, "小组"))
      },
    personas =
      listOf(
        MeBotPersonaRow(
          id = "p1",
          label = bot.roleTitle ?: bot.name,
          description = bot.persona,
        ),
      ),
    growth =
      MeBotGrowthSummary(
        level = if (owned) 2 else 1,
        activationScore = if (owned) 64 else 40,
        operationalScore = null,
        gapCount = if (owned) 1 else 0,
        capabilityReadyLabel = "已起步",
      ),
    collaborations =
      if (bot.agentId == "assistant-a" || bot.isDefault) {
        listOf(MeBotCollabRow(groupId = "space-a", title = "协作组A", sessionKey = "space:space-a"))
      } else {
        emptyList()
      },
  )
}

val DEMO_ME_AUTH_GRANTS =
  listOf(
    MeBotAuthGrantRow(
      identityId = "ent-wecom",
      title = "企业微信 · 销售岗",
      subtitle = "可同步",
      kind = "enterprise",
      enrolled = true,
    ),
    MeBotAuthGrantRow(
      identityId = "ent-feishu",
      title = "飞书 · 产品岗",
      subtitle = "可同步",
      kind = "enterprise",
      enrolled = false,
    ),
    MeBotAuthGrantRow(
      identityId = "per-wechat",
      title = "微信 · 张三",
      subtitle = "已绑定",
      kind = "personal",
      enrolled = true,
    ),
  )

val DEMO_ME_BOTS =

  listOf(
    MeBotRow(
      agentId = "main",
      name = "默认管家",
      emoji = "🤖",
      access = MeBotAccess.Owned,
      subtitle = "近期活跃",
      positioning = "固定首位管家",
      persona = "稳重可靠",
      roleTitle = "默认管家",
      isDefault = true,
    ),
    MeBotRow(
      agentId = "assistant-a",
      name = "助手甲",
      emoji = "🧑‍💻",
      access = MeBotAccess.Owned,
      subtitle = "可用",
      positioning = "研发助手",
      persona = "专业严谨",
      roleTitle = "研发助手",
    ),
    MeBotRow(
      agentId = "assistant-b",
      name = "助手乙",
      emoji = "🧭",
      access = MeBotAccess.Collab,
      subtitle = "近期活跃",
      positioning = "导航顾问",
      persona = "友好引导",
      roleTitle = "导航顾问",
    ),
  )

val DEMO_ME_GROUPS =
  listOf(
    MeGroupRow(
      groupId = "space-a",
      title = "协作组A",
      avatar = "👥",
      memberCount = 3,
      myRoleLabel = "群主",
      ownerLabel = "Ryan Anderson",
      coordinatorBotLabel = "默认管家",
    ),
    MeGroupRow(
      groupId = "space-b",
      title = "产品同步组",
      avatar = "👥",
      memberCount = 3,
      myRoleLabel = "成员",
      ownerLabel = "Dana",
      coordinatorBotLabel = "助手甲",
    ),
  )

val DEMO_ME_AUTH =
  listOf(
    MeAuthResourceRow(
      id = "id-wechat",
      title = "微信 · 张三",
      subtitle = "已绑定",
      zone = MeIdentityZone.Personal,
      provider = "wechat_personal",
      status = "active",
    ),
    MeAuthResourceRow(
      id = "id-wecom",
      title = "企业微信 · 销售岗",
      subtitle = "已同步",
      zone = MeIdentityZone.Enterprise,
      provider = "wecom",
      status = "active",
    ),
    MeAuthResourceRow(
      id = "model-gpt",
      title = "GPT-4.1",
      subtitle = "默认 · 席位可用",
      zone = MeIdentityZone.Model,
    ),
    MeAuthResourceRow(
      id = "model-claude",
      title = "Claude Sonnet",
      subtitle = "可用",
      zone = MeIdentityZone.Model,
    ),
    MeAuthResourceRow(
      id = "model-gemini",
      title = "Gemini",
      subtitle = "可用",
      zone = MeIdentityZone.Model,
    ),
  )

val DEMO_ME_DEVICES =
  listOf(
    MePairedDeviceRow(
      deviceId = "dev-demo-1",
      displayName = "本机 Android",
      platform = "android",
      isCurrent = true,
    ),
  )

private fun kotlinx.serialization.json.JsonElement.asObj(): JsonObject? = this as? JsonObject

private fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject

private fun JsonObject.arr(key: String): List<kotlinx.serialization.json.JsonElement>? =
  (this[key] as? JsonArray)?.toList()

private fun JsonObject.str(key: String): String? =
  when (val v = this[key]) {
    null, JsonNull -> null
    is JsonPrimitive -> v.contentOrNull?.trim()?.takeIf { it.isNotEmpty() }
    else -> null
  }

private fun JsonObject.bool(key: String): Boolean? =
  when (val v = this[key]) {
    is JsonPrimitive ->
      when {
        v.contentOrNull.equals("true", ignoreCase = true) -> true
        v.contentOrNull.equals("false", ignoreCase = true) -> false
        else -> null
      }
    else -> null
  }

private fun JsonObject.int(key: String): Int? =
  when (val v = this[key]) {
    is JsonPrimitive -> v.contentOrNull?.toIntOrNull() ?: v.longOrNull?.toInt()
    else -> null
  }
