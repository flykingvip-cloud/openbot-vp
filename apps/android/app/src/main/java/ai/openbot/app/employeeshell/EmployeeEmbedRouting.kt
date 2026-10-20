package ai.openbot.app.employeeshell

import java.net.URLEncoder

//
// Maps a decoded bridge intent to either an in-WebView embed navigation or a
// native host action (task 1.5-android). Pure + testable.
//
// Chat/assistant/space/knowledge reuse the same Control UI embed as
// https://www.openbot.love/. deviceSettings stays host-owned.
//

/** What the host should do with a decoded intent. */
sealed interface EmployeeShellRouteAction {
  /** Navigate the SAME WebView to a site-internal embed path (session already set). */
  data class EmbedNavigation(val path: String) : EmployeeShellRouteAction

  /** Forward to the native host (chat/assistant/device-settings/ready). */
  data class Native(val intent: EmployeeShellIntent) : EmployeeShellRouteAction
}

object EmployeeEmbedRouting {
  const val EMBED_PREFIX = "/embed/employee"

  /** `/embed/employee/<surface>`. */
  fun embedPath(surface: String): String = "$EMBED_PREFIX/$surface"

  /** `space/<spaceId>` -> workspace surface bound to the same `space:<id>` store as www. */
  fun embedPathForSpace(spaceId: String): String =
    pathWithQuery("workspace", listOf("session" to collaborationSessionKey(spaceId)))

  fun collaborationSessionKey(spaceId: String): String {
    var identity = spaceId.trim()
    while (identity.startsWith("space:", ignoreCase = true)) {
      identity = identity.substring(6).trim()
    }
    return "space:$identity"
  }

  /** `knowledge/<objectId>` -> knowledge surface carrying object id (+ optional kind). */
  fun embedPathForKnowledge(objectId: String, kind: String?): String {
    val items = buildList {
      add("objectId" to objectId)
      if (!kind.isNullOrEmpty()) add("kind" to kind)
    }
    return pathWithQuery("knowledge", items)
  }

  /** 1:1 chat lands on overview; collaboration `space:` keys land on workspace. */
  fun embedPathForChat(sessionKey: String?, agentId: String?): String {
    val key = sessionKey?.trim().orEmpty()
    val resolved =
      key.ifEmpty {
        agentId?.trim()?.takeIf { it.isNotEmpty() }?.let { "agent:$it:main" }.orEmpty()
      }
    val surface = if (resolved.startsWith("space:")) "workspace" else "overview"
    if (resolved.isEmpty()) return embedPath(surface)
    return pathWithQuery(surface, listOf("session" to resolved))
  }

  /** Route an intent to an embed navigation or a native action. */
  fun action(intent: EmployeeShellIntent): EmployeeShellRouteAction =
    when (intent) {
      is EmployeeShellIntent.OpenSpace -> EmployeeShellRouteAction.EmbedNavigation(embedPathForSpace(intent.spaceId))
      is EmployeeShellIntent.OpenKnowledgeObject ->
        EmployeeShellRouteAction.EmbedNavigation(embedPathForKnowledge(intent.objectId, intent.kind))
      is EmployeeShellIntent.OpenChat ->
        EmployeeShellRouteAction.EmbedNavigation(embedPathForChat(intent.sessionKey, intent.agentId))
      is EmployeeShellIntent.OpenAssistant ->
        EmployeeShellRouteAction.EmbedNavigation(embedPathForChat(null, intent.agentId))
      is EmployeeShellIntent.OpenDeviceSettings,
      is EmployeeShellIntent.Ready,
      -> EmployeeShellRouteAction.Native(intent)
    }

  private fun pathWithQuery(surface: String, items: List<Pair<String, String>>): String {
    if (items.isEmpty()) return embedPath(surface)
    val query = items.joinToString("&") { (name, value) -> "$name=${enc(value)}" }
    return "${embedPath(surface)}?$query"
  }

  private fun enc(value: String): String = URLEncoder.encode(value, "UTF-8")
}
