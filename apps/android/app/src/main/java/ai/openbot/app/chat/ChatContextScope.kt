package ai.openbot.app.chat

/**
 * Android port of Web chat context-scope SoT:
 * - `ui/src/ui/chat/context-scope.ts`
 * - `ui/src/ui/views/chat-context-scope.ts` (picker presentation)
 *
 * Presentation adapts to Compose; selection / cascade / send payload stay Web-aligned.
 */

enum class ChatContextSourceKind {
  Knowledge,
  File,
  Folder,
  Api,
}

enum class ChatContextVisibility {
  Private,
  Team,
  Enterprise,
}

enum class ChatContextCatalogGroupId {
  Private,
  Team,
  Enterprise,
  Ungrouped,
}

enum class ChatContextCheckState {
  Checked,
  Unchecked,
  Indeterminate,
  Covered,
}

enum class ChatContextLifetime {
  Turn,
  Session,
}

enum class ChatContextPreset {
  Auto,
  Conversation,
  Group,
  Knowledge,
  Deep,
  Custom,
}

data class ChatContextSourceSelection(
  val type: ChatContextSourceKind,
  val id: String,
  val label: String,
  val parentId: String? = null,
)

data class ChatContextSourceCatalogItem(
  val type: ChatContextSourceKind,
  val id: String,
  val label: String,
  val parentId: String? = null,
  val subtitle: String? = null,
  val visibility: ChatContextVisibility? = null,
  val hasConflict: Boolean = false,
) {
  fun asSelection(): ChatContextSourceSelection =
    ChatContextSourceSelection(type = type, id = id, label = label, parentId = parentId)
}

data class ChatContextCatalogNode(
  val item: ChatContextSourceCatalogItem,
  val children: List<ChatContextCatalogNode> = emptyList(),
)

data class ChatContextCatalogGroup(
  val visibility: ChatContextCatalogGroupId,
  val nodes: List<ChatContextCatalogNode>,
)

data class ChatContextScopeState(
  val preset: ChatContextPreset = ChatContextPreset.Auto,
  val lifetime: ChatContextLifetime = ChatContextLifetime.Turn,
  val pickerOpen: Boolean = false,
  val selectedSources: List<ChatContextSourceSelection> = emptyList(),
  val browserQuery: String = "",
  val deepEnabled: Boolean = false,
  val expandedKeys: List<String> = emptyList(),
)

/** Wire payload for `chat.send` `contextScope` (Web `toChatSendContextScope`). */
data class ChatContextScopePayload(
  val mode: String,
  val lifetime: String,
  val sources: List<ChatContextSourceRef> = emptyList(),
)

data class ChatContextSourceRef(
  val type: String,
  val id: String,
  val parentId: String? = null,
)

val DEFAULT_CHAT_CONTEXT_SCOPE = ChatContextScopeState()

val CONTEXT_CATALOG_GROUP_ORDER =
  listOf(
    ChatContextCatalogGroupId.Private,
    ChatContextCatalogGroupId.Team,
    ChatContextCatalogGroupId.Enterprise,
    ChatContextCatalogGroupId.Ungrouped,
  )

fun contextSourceKey(type: ChatContextSourceKind, id: String): String = "${typeWire(type)}:$id"

fun contextSourceKey(source: ChatContextSourceSelection): String = contextSourceKey(source.type, source.id)

fun contextSourceKey(item: ChatContextSourceCatalogItem): String = contextSourceKey(item.type, item.id)

fun typeWire(type: ChatContextSourceKind): String =
  when (type) {
    ChatContextSourceKind.Knowledge -> "knowledge"
    ChatContextSourceKind.File -> "file"
    ChatContextSourceKind.Folder -> "folder"
    ChatContextSourceKind.Api -> "api"
  }

fun catalogGroupLabel(visibility: ChatContextCatalogGroupId): String =
  when (visibility) {
    ChatContextCatalogGroupId.Private -> "个人"
    ChatContextCatalogGroupId.Team -> "团队"
    ChatContextCatalogGroupId.Enterprise -> "企业"
    ChatContextCatalogGroupId.Ungrouped -> "其他"
  }

fun summarizeSelectedSources(selected: List<ChatContextSourceSelection>): String? {
  if (selected.isEmpty()) return null
  val first = selected.first().label.trim().ifEmpty { selected.first().id }
  return if (selected.size == 1) first else "$first +${selected.size - 1}"
}

private fun catalogItemFor(
  item: ChatContextSourceSelection,
  catalog: List<ChatContextSourceCatalogItem>,
): ChatContextSourceCatalogItem {
  val key = contextSourceKey(item)
  return catalog.firstOrNull { contextSourceKey(it) == key }
    ?: ChatContextSourceCatalogItem(
      type = item.type,
      id = item.id,
      label = item.label,
      parentId = item.parentId,
    )
}

private fun resolveCatalogParent(
  item: ChatContextSourceCatalogItem,
  catalog: List<ChatContextSourceCatalogItem>,
): ChatContextSourceCatalogItem? {
  val parentId = item.parentId?.trim()?.takeIf { it.isNotEmpty() } ?: return null
  return catalog.firstOrNull {
    it.id == parentId && (it.type == ChatContextSourceKind.Knowledge || it.type == ChatContextSourceKind.Folder)
  } ?: catalog.firstOrNull { it.id == parentId }
}

private fun ancestorKeys(
  item: ChatContextSourceCatalogItem,
  catalog: List<ChatContextSourceCatalogItem>,
): List<String> {
  val keys = mutableListOf<String>()
  val seen = mutableSetOf<String>()
  var current = resolveCatalogParent(item, catalog)
  while (current != null) {
    val key = contextSourceKey(current)
    if (!seen.add(key)) break
    keys.add(key)
    current = resolveCatalogParent(current, catalog)
  }
  return keys
}

fun isCoveredBySelectedAncestor(
  item: ChatContextSourceCatalogItem,
  selectedKeys: Set<String>,
  catalog: List<ChatContextSourceCatalogItem>,
): Boolean = ancestorKeys(item, catalog).any { selectedKeys.contains(it) }

private fun descendantKeys(
  parent: ChatContextSourceCatalogItem,
  catalog: List<ChatContextSourceCatalogItem>,
): List<String> {
  val parentKey = contextSourceKey(parent)
  return catalog
    .filter { ancestorKeys(it, catalog).contains(parentKey) }
    .map { contextSourceKey(it) }
}

fun resolveContextSourceCheckState(
  item: ChatContextSourceCatalogItem,
  selectedKeys: Set<String>,
  catalog: List<ChatContextSourceCatalogItem>,
): ChatContextCheckState {
  val resolved = catalogItemFor(item.asSelection(), catalog)
  if (isCoveredBySelectedAncestor(resolved, selectedKeys, catalog)) {
    return ChatContextCheckState.Covered
  }
  if (selectedKeys.contains(contextSourceKey(resolved))) {
    return ChatContextCheckState.Checked
  }
  val selectedDescendants = descendantKeys(resolved, catalog).count { selectedKeys.contains(it) }
  return if (selectedDescendants > 0) ChatContextCheckState.Indeterminate else ChatContextCheckState.Unchecked
}

/** Web `toggleChatContextSource` — folder check cascades by dropping covered descendants. */
fun toggleChatContextSource(
  state: ChatContextScopeState,
  item: ChatContextSourceSelection,
  catalog: List<ChatContextSourceCatalogItem> = emptyList(),
): ChatContextScopeState {
  val resolved = catalogItemFor(item, catalog)
  val selectedKeys = state.selectedSources.map { contextSourceKey(it) }.toSet()
  if (isCoveredBySelectedAncestor(resolved, selectedKeys, catalog)) {
    return state
  }
  val key = contextSourceKey(resolved)
  val exists = selectedKeys.contains(key)
  val selectedSources =
    if (exists) {
      state.selectedSources.filter { contextSourceKey(it) != key }
    } else {
      val drop = descendantKeys(resolved, catalog).toSet()
      state.selectedSources.filter { !drop.contains(contextSourceKey(it)) } + resolved.asSelection()
    }
  val preset =
    when {
      selectedSources.isNotEmpty() -> ChatContextPreset.Custom
      state.preset == ChatContextPreset.Custom -> ChatContextPreset.Auto
      else -> state.preset
    }
  return state.copy(selectedSources = selectedSources, preset = preset)
}

fun toggleContextScopeExpanded(state: ChatContextScopeState, key: String): ChatContextScopeState {
  val exists = state.expandedKeys.contains(key)
  return state.copy(
    expandedKeys = if (exists) state.expandedKeys.filter { it != key } else state.expandedKeys + key,
    pickerOpen = true,
  )
}

private fun toNode(
  item: ChatContextSourceCatalogItem,
  childrenByParentId: Map<String, List<ChatContextSourceCatalogItem>>,
  visiting: MutableSet<String>,
): ChatContextCatalogNode {
  val key = contextSourceKey(item)
  if (!visiting.add(key)) return ChatContextCatalogNode(item = item, children = emptyList())
  val children =
    (childrenByParentId[item.id] ?: emptyList())
      .filter { contextSourceKey(it) != key }
      .map { toNode(it, childrenByParentId, visiting) }
  visiting.remove(key)
  return ChatContextCatalogNode(item = item, children = children)
}

/** Web `buildContextScopeCatalogTree` — groups by visibility (个人/团队/企业). */
fun buildContextScopeCatalogTree(items: List<ChatContextSourceCatalogItem>): List<ChatContextCatalogGroup> {
  val childIds = mutableSetOf<String>()
  val childrenByParentId = mutableMapOf<String, MutableList<ChatContextSourceCatalogItem>>()
  for (item in items) {
    val parent = resolveCatalogParent(item, items) ?: continue
    childIds.add(contextSourceKey(item))
    childrenByParentId.getOrPut(parent.id) { mutableListOf() }.add(item)
  }
  val roots = items.filter { !childIds.contains(contextSourceKey(it)) }
  val grouped = mutableMapOf<ChatContextCatalogGroupId, MutableList<ChatContextCatalogNode>>()
  for (root in roots) {
    val visibility =
      if (root.type == ChatContextSourceKind.Knowledge && root.visibility != null) {
        when (root.visibility) {
          ChatContextVisibility.Private -> ChatContextCatalogGroupId.Private
          ChatContextVisibility.Team -> ChatContextCatalogGroupId.Team
          ChatContextVisibility.Enterprise -> ChatContextCatalogGroupId.Enterprise
        }
      } else {
        ChatContextCatalogGroupId.Ungrouped
      }
    grouped.getOrPut(visibility) { mutableListOf() }.add(toNode(root, childrenByParentId, mutableSetOf()))
  }
  return CONTEXT_CATALOG_GROUP_ORDER.mapNotNull { id ->
    val nodes = grouped[id]
    if (nodes.isNullOrEmpty()) null else ChatContextCatalogGroup(visibility = id, nodes = nodes)
  }
}

data class FlatCatalogNode(val node: ChatContextCatalogNode, val depth: Int)

/** Flatten expanded tree nodes for LazyColumn (Chat picker + Knowledge browser). */
fun flattenVisibleCatalogNodes(
  nodes: List<ChatContextCatalogNode>,
  expandedKeys: Set<String>,
): List<FlatCatalogNode> {
  val out = mutableListOf<FlatCatalogNode>()
  fun walk(list: List<ChatContextCatalogNode>, depth: Int) {
    for (n in list) {
      out.add(FlatCatalogNode(n, depth))
      val key = contextSourceKey(n.item)
      if (n.children.isNotEmpty() && expandedKeys.contains(key)) {
        walk(n.children, depth + 1)
      }
    }
  }
  walk(nodes, 0)
  return out
}

/** Knowledge tab section labels (Web cockpit-tree / SoT: 个人空间·团队空间·企业空间). */
fun knowledgeBrowserSectionLabel(visibility: ChatContextCatalogGroupId): String =
  when (visibility) {
    ChatContextCatalogGroupId.Private -> "个人空间"
    ChatContextCatalogGroupId.Team -> "团队空间"
    ChatContextCatalogGroupId.Enterprise -> "企业空间"
    ChatContextCatalogGroupId.Ungrouped -> "其他"
  }

fun filterContextScopeCatalogTree(
  groups: List<ChatContextCatalogGroup>,
  query: String,
): Pair<List<ChatContextCatalogGroup>, List<String>> {
  val needle = query.trim().lowercase()
  if (needle.isEmpty()) return groups to emptyList()
  val expanded = mutableListOf<String>()
  fun filterNode(node: ChatContextCatalogNode): ChatContextCatalogNode? {
    val childHits = node.children.mapNotNull { filterNode(it) }
    val selfMatch =
      node.item.label.lowercase().contains(needle) ||
        node.item.id.lowercase().contains(needle) ||
        (node.item.subtitle?.lowercase()?.contains(needle) == true)
    if (!selfMatch && childHits.isEmpty()) return null
    if (childHits.isNotEmpty()) expanded.add(contextSourceKey(node.item))
    return ChatContextCatalogNode(
      item = node.item,
      children = if (selfMatch && needle.isNotEmpty()) node.children else childHits,
    )
  }
  val next =
    groups.mapNotNull { group ->
      val nodes = group.nodes.mapNotNull { filterNode(it) }
      if (nodes.isEmpty()) null else group.copy(nodes = nodes)
    }
  return next to expanded
}

/** Web `toChatSendContextScope` — only emit when selection / non-default lifetime needs it. */
fun toChatSendContextScope(
  state: ChatContextScopeState,
  sessionKey: String,
  catalog: List<ChatContextSourceCatalogItem> = emptyList(),
): ChatContextScopePayload? {
  val lifetime = if (state.lifetime == ChatContextLifetime.Session) "session" else "turn"
  val selected = state.selectedSources
  if (selected.isNotEmpty()) {
    val mode = if (state.deepEnabled || state.preset == ChatContextPreset.Deep) "deep" else "focused"
    val sources =
      selected.map { source ->
        val resolved = catalogItemFor(source, catalog)
        val parentId = resolved.parentId?.trim()?.takeIf { it.isNotEmpty() } ?: source.parentId
        ChatContextSourceRef(
          type = typeWire(source.type),
          id = source.id,
          parentId = if (source.type == ChatContextSourceKind.Knowledge) null else parentId,
        )
      }
    return ChatContextScopePayload(mode = mode, lifetime = lifetime, sources = sources)
  }
  if (state.preset == ChatContextPreset.Conversation) {
    return ChatContextScopePayload(mode = "minimal", lifetime = lifetime)
  }
  if (state.deepEnabled || state.preset == ChatContextPreset.Deep) {
    return ChatContextScopePayload(mode = "deep", lifetime = lifetime)
  }
  if (state.preset == ChatContextPreset.Auto || state.preset == ChatContextPreset.Custom) {
    return if (lifetime == "turn") null else ChatContextScopePayload(mode = "auto", lifetime = lifetime)
  }
  if (state.preset == ChatContextPreset.Group) {
    val groupId = resolveGroupIdFromSessionKey(sessionKey) ?: return null
    return ChatContextScopePayload(
      mode = "focused",
      lifetime = lifetime,
      sources = listOf(ChatContextSourceRef(type = "group", id = groupId)),
    )
  }
  return ChatContextScopePayload(
    mode = "focused",
    lifetime = lifetime,
    sources = listOf(ChatContextSourceRef(type = "knowledge", id = "authorized")),
  )
}

fun resolveGroupIdFromSessionKey(sessionKey: String?): String? {
  val key = sessionKey?.trim().orEmpty()
  if (key.isEmpty()) return null
  if (key.startsWith("space:")) return key.removePrefix("space:").trim().takeIf { it.isNotEmpty() }
  val marker = ":space:"
  val index = key.indexOf(marker)
  if (index >= 0) return key.substring(index + marker.length).trim().takeIf { it.isNotEmpty() }
  return null
}
