package ai.openbot.app.ui.chat

import ai.openbot.app.chat.ChatAgentEntry
import ai.openbot.app.chat.ChatSessionEntry

/**
 * Android Stage 2.3 Agent Strip nav model.
 *
 * Web SoT: `ui/.../workbench-nav-model.ts` (`assistantItems` + `spaceItems`),
 * `workbench-home-model.ts` (teamAssistants from `agents.list`, teamSpaces from groups),
 * `workbench-chrome.ts` (badge ≤9), steward locks `13556f487` / `aab45779f`.
 *
 * Strip roster = agents.list assistants + space-scoped sessions (NOT 近24h
 * `resolveSessionChoices` / sessions.list as the roster). Select → sessionKey.
 * Default 大白管家.
 */

const val BUILTIN_STEWARD_NAME = "大白管家"
const val BUILTIN_STEWARD_NAV_ID = "daibai"
const val BUILTIN_STEWARD_AGENT_ID = "main"

/** Web chrome: `Math.min(props.count, 9)` — never 99+. */
const val AGENT_STRIP_BADGE_CAP = 9

enum class AgentStripModule {
  Assistant,
  Collaboration,
}

enum class AgentStripIconKey {
  Brain,
  Sparkles,
  MessageSquare,
  Zap,
  Star,
  Radio,
  Mic,
  Users,
  MessagesSquare,
  Calendar,
  ClipboardCheck,
}

data class AgentStripItem(
  val id: String,
  val selectionKey: String,
  val title: String,
  val rawTitle: String,
  val module: AgentStripModule,
  val iconKey: AgentStripIconKey,
  val active: Boolean,
  val count: Int? = null,
)

data class AgentStripNavModel(
  val assistantItems: List<AgentStripItem>,
  val spaceItems: List<AgentStripItem>,
) {
  /** Flattened strip order: assistants first (steward leading), then spaces — Web chrome order. */
  val stripItems: List<AgentStripItem>
    get() = assistantItems + spaceItems

  fun selectedItem(sessionKey: String): AgentStripItem? {
    val key = sessionKey.trim()
    stripItems.firstOrNull { it.selectionKey == key && it.active }?.let { return it }
    stripItems.firstOrNull { it.selectionKey == key }?.let { return it }
    stripItems.firstOrNull { it.active }?.let { return it }
    return assistantItems.firstOrNull { it.id == BUILTIN_STEWARD_NAV_ID }
      ?: assistantItems.firstOrNull()
      ?: stripItems.firstOrNull()
  }

  fun toHeaderLabel(sessionKey: String): String {
    val item = selectedItem(sessionKey) ?: return "TO: $BUILTIN_STEWARD_NAME"
    val name = sanitizeWorkbenchPeerTitle(item.rawTitle.ifBlank { item.title })
    return if (name.isBlank()) "" else "TO: $name"
  }
}

private val ASSISTANT_ICON_CYCLE =
  listOf(
    AgentStripIconKey.Sparkles,
    AgentStripIconKey.MessageSquare,
    AgentStripIconKey.Zap,
    AgentStripIconKey.Star,
    AgentStripIconKey.Radio,
    AgentStripIconKey.Mic,
  )

private val SPACE_ICON_CYCLE =
  listOf(
    AgentStripIconKey.Users,
    AgentStripIconKey.MessagesSquare,
    AgentStripIconKey.Calendar,
    AgentStripIconKey.ClipboardCheck,
  )

/** Web SoT `sanitizeWorkbenchPeerTitle` — collapse duplicated 管家 suffix. */
fun sanitizeWorkbenchPeerTitle(title: String): String {
  return title
    .replace(Regex("管家家+$"), "管家")
    .replace(Regex("\\s+"), " ")
    .trim()
}

fun isSpaceScopedSessionKey(key: String): Boolean {
  val raw = key.trim()
  return raw.startsWith("space:") ||
    raw.startsWith("group:") ||
    raw.contains(":space:")
}

fun isBuiltinStewardSessionKey(sessionKey: String, mainSessionKey: String): Boolean {
  val raw = sessionKey.trim()
  if (raw.isEmpty()) return false
  val mainKey = mainSessionKey.trim().ifEmpty { "main" }
  if (raw == mainKey || raw == "main" || raw == "agent:main" || raw.equals("global", ignoreCase = true)) {
    return true
  }
  if (raw == "agent:main:main") return true
  return false
}

fun isBuiltinStewardAgentId(agentId: String): Boolean {
  val id = agentId.trim()
  return id.isEmpty() || id == BUILTIN_STEWARD_AGENT_ID || id.equals("daibai", ignoreCase = true)
}

/**
 * Cap unread badge like Web `workbench-chrome.ts` (`Math.min(count, 9)`).
 * Returns null when count is null or ≤0.
 */
fun formatAgentStripBadge(count: Int?): String? {
  if (count == null || count <= 0) return null
  return minOf(count, AGENT_STRIP_BADGE_CAP).toString()
}

/** Resolve primary 1:1 sessionKey for an agents.list row (Web resolveAgentPrimarySessionKey). */
fun resolveAgentPrimarySessionKey(
  agentId: String,
  sessions: List<ChatSessionEntry>,
  mainSessionKey: String,
): String {
  val id = agentId.trim().ifEmpty { BUILTIN_STEWARD_AGENT_ID }
  val mainKey = mainSessionKey.trim().ifEmpty { "main" }
  if (isBuiltinStewardAgentId(id)) {
    val direct =
      sessions.filter { !isSpaceScopedSessionKey(it.key) }
    return direct.firstOrNull { isBuiltinStewardSessionKey(it.key, mainKey) }?.key
      ?: mainKey
  }
  val canonical = "agent:$id:main"
  sessions.firstOrNull { it.key == canonical }?.key?.let { return it }
  sessions.firstOrNull {
    val key = it.key
    !isSpaceScopedSessionKey(key) &&
      (key == "agent:$id" || key.startsWith("agent:$id:"))
  }?.key?.let { return it }
  return canonical
}

/**
 * Build strip from Web SoT teamAssistants (`agents.list`) + teamSpaces (space-scoped
 * sessions). Does **not** use `resolveSessionChoices` / 近24h sessions.list as roster.
 * Selecting still sets sessionKey for chat.
 */
fun buildAgentStripNavModel(
  agents: List<ChatAgentEntry>,
  sessions: List<ChatSessionEntry>,
  activeSessionKey: String,
  mainSessionKey: String,
): AgentStripNavModel {
  val mainKey = mainSessionKey.trim().ifEmpty { "main" }
  val activeKey =
    activeSessionKey.trim().let { key ->
      if (key == "main" && mainKey != "main") mainKey else key
    }.ifEmpty { mainKey }

  val assistants = mutableListOf<AgentStripItem>()
  val spaces = mutableListOf<AgentStripItem>()
  var nonDaibaiIndex = 0
  var spaceIndex = 0
  val seenAssistantIds = mutableSetOf<String>()
  val seenSpaceTitles = mutableSetOf<String>()

  // --- Assistants from agents.list (always seed steward first) ---
  val orderedAgents = agents.sortedBy { if (isBuiltinStewardAgentId(it.id)) 0 else 1 }
  val hasSteward = orderedAgents.any { isBuiltinStewardAgentId(it.id) }
  val agentRows =
    if (hasSteward) {
      orderedAgents
    } else {
      listOf(
        ChatAgentEntry(id = BUILTIN_STEWARD_AGENT_ID, name = BUILTIN_STEWARD_NAME, isDefault = true),
      ) + orderedAgents
    }

  for (agent in agentRows) {
    val agentId = agent.id.trim().ifEmpty { BUILTIN_STEWARD_AGENT_ID }
    if (!seenAssistantIds.add(agentId.lowercase())) continue
    val isSteward = isBuiltinStewardAgentId(agentId)
    val selectionKey = resolveAgentPrimarySessionKey(agentId, sessions, mainKey)
    val rawTitle =
      sanitizeWorkbenchPeerTitle(
        agent.name?.takeIf { it.isNotBlank() }
          ?: sessions.firstOrNull { it.key == selectionKey }?.displayName?.takeIf { it.isNotBlank() }
          ?: if (isSteward) BUILTIN_STEWARD_NAME else agentId,
      ).ifBlank { if (isSteward) BUILTIN_STEWARD_NAME else agentId }
    val icon =
      if (isSteward) {
        AgentStripIconKey.Brain
      } else {
        val icon = ASSISTANT_ICON_CYCLE[nonDaibaiIndex % ASSISTANT_ICON_CYCLE.size]
        nonDaibaiIndex += 1
        icon
      }
    val active =
      if (isSteward) {
        isBuiltinStewardSessionKey(activeKey, mainKey) || activeKey == selectionKey
      } else {
        activeKey == selectionKey ||
          activeKey == "agent:$agentId:main" ||
          activeKey.startsWith("agent:$agentId:")
      }
    assistants.add(
      AgentStripItem(
        id = if (isSteward) BUILTIN_STEWARD_NAV_ID else "assistant:$agentId",
        selectionKey = selectionKey,
        title = truncateStripTitle(rawTitle),
        rawTitle = rawTitle,
        module = AgentStripModule.Assistant,
        iconKey = icon,
        active = active,
        count = null,
      ),
    )
  }

  // --- Spaces from space/group-scoped sessions (no 24h window) ---
  val spaceSessions =
    sessions
      .filter { isSpaceScopedSessionKey(it.key) }
      .sortedByDescending { it.updatedAtMs ?: 0L }
  for (entry in spaceSessions) {
    val key = entry.key.trim()
    if (key.isEmpty()) continue
    val rawTitle =
      sanitizeWorkbenchPeerTitle(
        entry.displayName?.takeIf { it.isNotBlank() } ?: friendlySessionName(key),
      ).ifBlank { friendlySessionName(key) }
    val titleKey = rawTitle.lowercase()
    if (!seenSpaceTitles.add(titleKey)) continue
    val icon = SPACE_ICON_CYCLE[spaceIndex % SPACE_ICON_CYCLE.size]
    spaceIndex += 1
    spaces.add(
      AgentStripItem(
        id = key,
        selectionKey = key,
        title = truncateStripTitle(rawTitle),
        rawTitle = rawTitle,
        module = AgentStripModule.Collaboration,
        iconKey = icon,
        active = !isBuiltinStewardSessionKey(activeKey, mainKey) && key == activeKey,
        count = null,
      ),
    )
  }

  // Ensure current non-steward session appears if it is an unknown assistant key
  // (e.g. agents.list lag) — still not via resolveSessionChoices.
  if (activeKey.isNotEmpty() &&
    !isBuiltinStewardSessionKey(activeKey, mainKey) &&
    assistants.none { it.selectionKey == activeKey || it.id == "assistant:$activeKey" } &&
    spaces.none { it.selectionKey == activeKey }
  ) {
    val rawTitle =
      sanitizeWorkbenchPeerTitle(
        sessions.firstOrNull { it.key == activeKey }?.displayName?.takeIf { it.isNotBlank() }
          ?: friendlySessionName(activeKey),
      )
    if (isSpaceScopedSessionKey(activeKey)) {
      spaces.add(
        AgentStripItem(
          id = activeKey,
          selectionKey = activeKey,
          title = truncateStripTitle(rawTitle),
          rawTitle = rawTitle,
          module = AgentStripModule.Collaboration,
          iconKey = SPACE_ICON_CYCLE[spaceIndex % SPACE_ICON_CYCLE.size],
          active = true,
          count = null,
        ),
      )
    } else {
      assistants.add(
        AgentStripItem(
          id = "assistant:$activeKey",
          selectionKey = activeKey,
          title = truncateStripTitle(rawTitle),
          rawTitle = rawTitle,
          module = AgentStripModule.Assistant,
          iconKey = ASSISTANT_ICON_CYCLE[nonDaibaiIndex % ASSISTANT_ICON_CYCLE.size],
          active = true,
          count = null,
        ),
      )
    }
  }

  return AgentStripNavModel(assistantItems = assistants, spaceItems = spaces)
}

private fun truncateStripTitle(title: String, maxChars: Int = 6): String {
  val trimmed = title.trim()
  if (trimmed.length <= maxChars) return trimmed
  return trimmed.take(maxChars - 1) + "…"
}
