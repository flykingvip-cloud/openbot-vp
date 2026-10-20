package ai.openbot.app.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors Web context-scope cascade / group tree semantics. */
class ChatContextScopeTest {
  @Test
  fun stewardGroups_personalTeamEnterpriseOrder() {
    val catalog =
      listOf(
        ChatContextSourceCatalogItem(
          type = ChatContextSourceKind.Knowledge,
          id = "kb-p",
          label = "个人成果",
          visibility = ChatContextVisibility.Private,
        ),
        ChatContextSourceCatalogItem(
          type = ChatContextSourceKind.Knowledge,
          id = "kb-t",
          label = "团队成果",
          visibility = ChatContextVisibility.Team,
        ),
        ChatContextSourceCatalogItem(
          type = ChatContextSourceKind.Folder,
          id = "folder-1",
          label = "子文件夹",
          parentId = "kb-p",
        ),
        ChatContextSourceCatalogItem(
          type = ChatContextSourceKind.File,
          id = "file-1",
          label = "说明.md",
          parentId = "folder-1",
        ),
      )
    val tree = buildContextScopeCatalogTree(catalog)
    assertEquals(listOf("个人", "团队"), tree.map { catalogGroupLabel(it.visibility) })
    assertEquals(1, tree[0].nodes.size)
    assertEquals("个人成果", tree[0].nodes[0].item.label)
    assertEquals(1, tree[0].nodes[0].children.size)
  }

  @Test
  fun toggleFolder_cascadesByDroppingDescendants() {
    val catalog =
      listOf(
        ChatContextSourceCatalogItem(
          type = ChatContextSourceKind.Knowledge,
          id = "kb",
          label = "KB",
          visibility = ChatContextVisibility.Private,
        ),
        ChatContextSourceCatalogItem(
          type = ChatContextSourceKind.Folder,
          id = "f",
          label = "Folder",
          parentId = "kb",
        ),
        ChatContextSourceCatalogItem(
          type = ChatContextSourceKind.File,
          id = "doc",
          label = "Doc",
          parentId = "f",
        ),
      )
    var scope = DEFAULT_CHAT_CONTEXT_SCOPE
    scope =
      toggleChatContextSource(
        scope,
        ChatContextSourceSelection(ChatContextSourceKind.File, "doc", "Doc", parentId = "f"),
        catalog,
      )
    assertEquals(1, scope.selectedSources.size)
    scope =
      toggleChatContextSource(
        scope,
        ChatContextSourceSelection(ChatContextSourceKind.Folder, "f", "Folder", parentId = "kb"),
        catalog,
      )
    assertEquals(1, scope.selectedSources.size)
    assertEquals("f", scope.selectedSources.single().id)
    assertEquals(
      ChatContextCheckState.Covered,
      resolveContextSourceCheckState(catalog[2], scope.selectedSources.map { contextSourceKey(it) }.toSet(), catalog),
    )
  }

  @Test
  fun toChatSend_emitsFocusedSources() {
    val scope =
      ChatContextScopeState(
        preset = ChatContextPreset.Custom,
        selectedSources =
          listOf(
            ChatContextSourceSelection(ChatContextSourceKind.Knowledge, "kb-1", "个人成果"),
          ),
      )
    val payload = toChatSendContextScope(scope, "main")
    assertEquals("focused", payload?.mode)
    assertEquals("turn", payload?.lifetime)
    assertEquals("knowledge", payload?.sources?.single()?.type)
    assertEquals("kb-1", payload?.sources?.single()?.id)
  }

  @Test
  fun toChatSend_autoTurn_isNull() {
    assertNull(toChatSendContextScope(DEFAULT_CHAT_CONTEXT_SCOPE, "main"))
  }

  @Test
  fun summarize_plusCount() {
    val summary =
      summarizeSelectedSources(
        listOf(
          ChatContextSourceSelection(ChatContextSourceKind.Knowledge, "a", "Alpha"),
          ChatContextSourceSelection(ChatContextSourceKind.File, "b", "Beta"),
        ),
      )
    assertEquals("Alpha +1", summary)
    assertTrue(catalogGroupLabel(ChatContextCatalogGroupId.Enterprise) == "企业")
  }
}
