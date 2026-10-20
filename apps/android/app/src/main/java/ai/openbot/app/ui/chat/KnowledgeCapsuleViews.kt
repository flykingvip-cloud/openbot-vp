package ai.openbot.app.ui.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.LocalMinimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ai.openbot.app.chat.ChatContextCatalogGroup
import ai.openbot.app.chat.ChatContextCatalogNode
import ai.openbot.app.chat.ChatContextCheckState
import ai.openbot.app.chat.ChatContextLifetime
import ai.openbot.app.chat.ChatContextScopeState
import ai.openbot.app.chat.ChatContextSourceCatalogItem
import ai.openbot.app.chat.ChatContextSourceKind
import ai.openbot.app.chat.ChatContextSourceSelection
import ai.openbot.app.chat.buildContextScopeCatalogTree
import ai.openbot.app.chat.catalogGroupLabel
import ai.openbot.app.chat.contextSourceKey
import ai.openbot.app.chat.filterContextScopeCatalogTree
import ai.openbot.app.chat.flattenVisibleCatalogNodes
import ai.openbot.app.chat.resolveContextSourceCheckState
import ai.openbot.app.chat.summarizeSelectedSources
import ai.openbot.app.chat.toggleChatContextSource
import ai.openbot.app.chat.toggleContextScopeExpanded
import ai.openbot.app.ui.mobileBody
import ai.openbot.app.ui.mobileBorder
import ai.openbot.app.ui.mobileCaption1
import ai.openbot.app.ui.mobileHeadline
import ai.openbot.app.ui.mobileText
import ai.openbot.app.ui.mobileTextSecondary
import ai.openbot.app.ui.mobileTextTertiary

/** SoT pink「知识库」capsule (`web-composer-sot` / four-tab preview). */
private val kbCapsuleBg = Color(0xFFFCE8E6)
private val kbCapsuleActiveBg = Color(0xFFFBD5D0)
private val kbCapsuleRing = Color(0xFFF9A8A0)
private val kbCapsuleVal = Color(0xFFB91C1C)
private val kbCheckBlue = Color(0xFF2563EB)

@Composable
fun KnowledgeCapsuleRow(
  scope: ChatContextScopeState,
  onOpenPicker: () -> Unit,
  modifier: Modifier = Modifier,
) {
  val summary = summarizeSelectedSources(scope.selectedSources)
  val active = !summary.isNullOrBlank()
  // Match HTML `.cap.kb` height (padding 6px + label) — disable 48.dp min touch
  // inflation so capsule↔composer visual gap equals SoT `padding-bottom: 8px`.
  Row(
    modifier = modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
    horizontalArrangement = Arrangement.spacedBy(8.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    CompositionLocalProvider(LocalMinimumInteractiveComponentSize provides Dp.Unspecified) {
      Surface(
        onClick = onOpenPicker,
        shape = RoundedCornerShape(999.dp),
        color = if (active) kbCapsuleActiveBg else kbCapsuleBg,
        border = if (active) BorderStroke(1.5.dp, kbCapsuleRing) else null,
        tonalElevation = 0.dp,
        shadowElevation = 0.dp,
      ) {
        Row(
          modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
          Icon(
            imageVector = Icons.Default.AutoAwesome,
            contentDescription = null,
            tint = Color(0xFF18181B),
            modifier = Modifier.size(14.dp),
          )
          Text(
            text = "知识库",
            style = mobileCaption1.copy(fontWeight = FontWeight.SemiBold, fontSize = 12.5.sp),
            color = Color(0xFF3F3F46),
          )
          if (summary != null) {
            Text(
              text = summary,
              style = mobileCaption1.copy(fontWeight = FontWeight.Bold, fontSize = 12.sp),
              color = kbCapsuleVal,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
              modifier = Modifier.width(110.dp),
            )
          }
        }
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KnowledgeScopePickerSheet(
  open: Boolean,
  scope: ChatContextScopeState,
  catalog: List<ChatContextSourceCatalogItem>,
  loading: Boolean,
  onDismiss: () -> Unit,
  onScopeChange: (ChatContextScopeState) -> Unit,
  onEnsureCatalog: () -> Unit,
) {
  if (!open) return
  LaunchedEffect(Unit) { onEnsureCatalog() }
  val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = sheetState,
    containerColor = Color.White,
  ) {
    KnowledgeScopePickerBody(
      scope = scope,
      catalog = catalog,
      loading = loading,
      onScopeChange = onScopeChange,
      onDone = onDismiss,
    )
  }
}

@Composable
private fun KnowledgeScopePickerBody(
  scope: ChatContextScopeState,
  catalog: List<ChatContextSourceCatalogItem>,
  loading: Boolean,
  onScopeChange: (ChatContextScopeState) -> Unit,
  onDone: () -> Unit,
) {
  var query by remember { mutableStateOf(scope.browserQuery) }
  val tree = remember(catalog) { buildContextScopeCatalogTree(catalog) }
  val (filtered, searchExpanded) =
    remember(tree, query) { filterContextScopeCatalogTree(tree, query) }
  val expandedKeys =
    remember(scope.expandedKeys, searchExpanded) {
      (scope.expandedKeys + searchExpanded).toSet()
    }
  val selectedKeys = remember(scope.selectedSources) { scope.selectedSources.map { contextSourceKey(it) }.toSet() }

  Column(
    modifier =
      Modifier
        .fillMaxWidth()
        .padding(horizontal = 16.dp)
        .padding(bottom = 24.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    Text(
      text = "上下文来源",
      style = mobileHeadline.copy(fontWeight = FontWeight.Bold),
      color = mobileText,
    )

    if (scope.selectedSources.isNotEmpty()) {
      Row(
        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
      ) {
        for (sel in scope.selectedSources) {
          SelectedSourceChip(
            label = sel.label,
            onRemove = {
              onScopeChange(toggleChatContextSource(scope, sel, catalog))
            },
          )
        }
      }
    }

    OutlinedTextField(
      value = query,
      onValueChange = {
        query = it
        onScopeChange(scope.copy(browserQuery = it, pickerOpen = true))
      },
      modifier = Modifier.fillMaxWidth(),
      singleLine = true,
      placeholder = {
        Text("搜索知识空间、文件夹或文件", style = mobileBody, color = mobileTextTertiary)
      },
      leadingIcon = {
        Icon(Icons.Default.Search, contentDescription = null, tint = mobileTextTertiary)
      },
      shape = RoundedCornerShape(12.dp),
      colors =
        OutlinedTextFieldDefaults.colors(
          focusedContainerColor = Color(0xFFF9FAFB),
          unfocusedContainerColor = Color(0xFFF9FAFB),
          focusedBorderColor = mobileBorder,
          unfocusedBorderColor = mobileBorder,
        ),
    )

    Surface(
      modifier = Modifier.fillMaxWidth().heightIn(min = 160.dp, max = 320.dp),
      shape = RoundedCornerShape(12.dp),
      color = Color.White,
      border = BorderStroke(1.dp, mobileBorder),
    ) {
      when {
        loading && catalog.isEmpty() -> {
          Text(
            text = "加载知识目录…",
            style = mobileBody,
            color = mobileTextSecondary,
            modifier = Modifier.padding(16.dp),
          )
        }
        filtered.isEmpty() -> {
          Text(
            text = if (catalog.isEmpty()) "暂无可用知识来源（需连接 Gateway）" else "无匹配结果",
            style = mobileBody,
            color = mobileTextSecondary,
            modifier = Modifier.padding(16.dp),
          )
        }
        else -> {
          LazyColumn(
            contentPadding = PaddingValues(6.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
          ) {
            for (group in filtered) {
              item(key = "sec-${group.visibility}") {
                Text(
                  text = catalogGroupLabel(group.visibility),
                  style = mobileCaption1.copy(fontWeight = FontWeight.Bold, fontSize = 11.sp),
                  color = mobileTextSecondary,
                  modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp),
                )
              }
              items(flattenVisibleCatalogNodes(group.nodes, expandedKeys), key = { contextSourceKey(it.node.item) + ":${it.depth}" }) { row ->
                CatalogTreeRow(
                  node = row.node,
                  depth = row.depth,
                  catalog = catalog,
                  selectedKeys = selectedKeys,
                  expanded = expandedKeys.contains(contextSourceKey(row.node.item)),
                  onToggleExpand = {
                    onScopeChange(toggleContextScopeExpanded(scope, contextSourceKey(row.node.item)))
                  },
                  onToggleSelect = {
                    onScopeChange(toggleChatContextSource(scope, row.node.item.asSelection(), catalog))
                  },
                )
              }
            }
          }
        }
      }
    }

    LifetimeChips(
      lifetime = scope.lifetime,
      onChange = { onScopeChange(scope.copy(lifetime = it, pickerOpen = true)) },
    )

    val sum =
      summarizeSelectedSources(scope.selectedSources)?.let { "本次将使用：$it" }
        ?: "本次将使用：未选择"
    Text(text = sum, style = mobileCaption1, color = mobileTextSecondary)

    Surface(
      onClick = onDone,
      modifier = Modifier.fillMaxWidth(),
      shape = RoundedCornerShape(12.dp),
      color = Color(0xFFF3F4F6),
    ) {
      Text(
        text = "完成",
        style = mobileBody.copy(fontWeight = FontWeight.SemiBold),
        color = mobileText,
        modifier = Modifier.padding(vertical = 14.dp).fillMaxWidth(),
        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
      )
    }
  }
}

@Composable
private fun LifetimeChips(
  lifetime: ChatContextLifetime,
  onChange: (ChatContextLifetime) -> Unit,
) {
  Row(
    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
    horizontalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    LifetimeChip("仅本轮", lifetime == ChatContextLifetime.Turn) { onChange(ChatContextLifetime.Turn) }
    LifetimeChip("应用到当前会话", lifetime == ChatContextLifetime.Session) {
      onChange(ChatContextLifetime.Session)
    }
  }
}

@Composable
private fun LifetimeChip(label: String, active: Boolean, onClick: () -> Unit) {
  Surface(
    onClick = onClick,
    shape = RoundedCornerShape(999.dp),
    color = if (active) Color(0xFFEFF6FF) else Color(0xFFF3F4F6),
    border = if (active) BorderStroke(1.dp, Color(0xFFBFDBFE)) else null,
  ) {
    Text(
      text = label,
      style = mobileCaption1.copy(fontWeight = if (active) FontWeight.Bold else FontWeight.Medium),
      color = if (active) Color(0xFF2563EB) else mobileTextSecondary,
      modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
    )
  }
}

@Composable
private fun SelectedSourceChip(label: String, onRemove: () -> Unit) {
  Surface(
    shape = RoundedCornerShape(999.dp),
    color = kbCapsuleBg,
  ) {
    Row(
      modifier = Modifier.padding(start = 10.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
      Text(
        text = label,
        style = mobileCaption1.copy(fontWeight = FontWeight.SemiBold, fontSize = 12.sp),
        color = Color(0xFF3F3F46),
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
      Surface(onClick = onRemove, shape = CircleShape, color = Color(0xFFD1D5DB), modifier = Modifier.size(16.dp)) {
        Text(
          text = "×",
          color = Color.White,
          fontSize = 10.sp,
          modifier = Modifier.padding(horizontal = 4.dp),
        )
      }
    }
  }
}

@Composable
private fun CatalogTreeRow(
  node: ChatContextCatalogNode,
  depth: Int,
  catalog: List<ChatContextSourceCatalogItem>,
  selectedKeys: Set<String>,
  expanded: Boolean,
  onToggleExpand: () -> Unit,
  onToggleSelect: () -> Unit,
) {
  val item = node.item
  val check = resolveContextSourceCheckState(item, selectedKeys, catalog)
  val hasChildren = node.children.isNotEmpty()
  Row(
    modifier =
      Modifier
        .fillMaxWidth()
        .clickable(enabled = check != ChatContextCheckState.Covered, onClick = onToggleSelect)
        .padding(start = (8 + depth * 14).dp, end = 8.dp, top = 7.dp, bottom = 7.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    if (hasChildren) {
      Surface(onClick = onToggleExpand, shape = RoundedCornerShape(4.dp), color = Color.Transparent) {
        Icon(
          imageVector = if (expanded) Icons.Default.ExpandMore else Icons.AutoMirrored.Filled.KeyboardArrowRight,
          contentDescription = if (expanded) "折叠" else "展开",
          tint = mobileTextSecondary,
          modifier = Modifier.size(18.dp),
        )
      }
    } else {
      Spacer(Modifier.size(18.dp))
    }
    CheckBoxGlyph(state = check)
    Icon(
      imageVector =
        when (item.type) {
          ChatContextSourceKind.Folder -> Icons.Default.Folder
          ChatContextSourceKind.File -> Icons.AutoMirrored.Filled.InsertDriveFile
          else -> Icons.Default.AutoAwesome
        },
      contentDescription = null,
      tint = mobileTextSecondary,
      modifier = Modifier.size(16.dp),
    )
    Text(
      text = item.label,
      style =
        mobileBody.copy(
          fontWeight =
            if (item.type == ChatContextSourceKind.Folder || item.type == ChatContextSourceKind.Knowledge) {
              FontWeight.SemiBold
            } else {
              FontWeight.Medium
            },
          fontSize = 13.sp,
        ),
      color = if (check == ChatContextCheckState.Covered) mobileTextTertiary else mobileText,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
      modifier = Modifier.weight(1f),
    )
  }
}

@Composable
private fun CheckBoxGlyph(state: ChatContextCheckState) {
  val bg =
    when (state) {
      ChatContextCheckState.Checked, ChatContextCheckState.Covered -> kbCheckBlue
      ChatContextCheckState.Indeterminate -> kbCheckBlue
      ChatContextCheckState.Unchecked -> Color.White
    }
  val border =
    when (state) {
      ChatContextCheckState.Unchecked -> Color(0xFFD1D5DB)
      else -> kbCheckBlue
    }
  Surface(
    shape = RoundedCornerShape(4.dp),
    color = bg,
    border = BorderStroke(1.5.dp, border),
    modifier = Modifier.size(16.dp),
  ) {
    when (state) {
      ChatContextCheckState.Checked, ChatContextCheckState.Covered ->
        Icon(Icons.Default.Check, contentDescription = null, tint = Color.White, modifier = Modifier.padding(1.dp))
      ChatContextCheckState.Indeterminate ->
        Icon(Icons.Default.Remove, contentDescription = null, tint = Color.White, modifier = Modifier.padding(1.dp))
      ChatContextCheckState.Unchecked -> Unit
    }
  }
}

