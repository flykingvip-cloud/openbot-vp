package ai.openbot.app.ui

import android.app.Activity
import kotlinx.coroutines.delay
import androidx.compose.ui.viewinterop.AndroidView
import android.webkit.WebViewClient
import android.webkit.WebView
import android.annotation.SuppressLint
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ai.openbot.app.BuildConfig
import ai.openbot.app.MainViewModel
import ai.openbot.app.chat.ChatContextCatalogGroup
import ai.openbot.app.chat.ChatContextCatalogNode
import ai.openbot.app.chat.ChatContextSourceCatalogItem
import ai.openbot.app.chat.ChatContextSourceKind
import ai.openbot.app.chat.buildContextScopeCatalogTree
import ai.openbot.app.chat.contextSourceKey
import ai.openbot.app.chat.filterContextScopeCatalogTree
import ai.openbot.app.chat.flattenVisibleCatalogNodes
import ai.openbot.app.chat.knowledgeBrowserSectionLabel

/**
 * Four-tab SoT Knowledge: 我的知识库 tree + search; tap doc → fullscreen
 * (tree collapses to left rail).
 *
 * Reuses the **same** Web catalog flow as Chat pink「知识库」capsule
 * (`context.scope.sources.catalog` → `knowledge.base.list` + sources via
 * [MainViewModel.refreshChatContextCatalog] / [MainViewModel.chatContextSourceCatalog]).
 * Doc body: Web `knowledge.document.preview` when kbId resolvable.
 */
@Composable
fun MobileKnowledgeScreen(
  viewModel: MainViewModel,
  @Suppress("UNUSED_PARAMETER") onOpenChat: (prompt: String) -> Unit,
  modifier: Modifier = Modifier,
) {
  val isConnected by viewModel.isConnected.collectAsState()
  val catalog by viewModel.chatContextSourceCatalog.collectAsState()
  val catalogLoading by viewModel.chatContextCatalogLoading.collectAsState()
  val context = LocalContext.current
  val demoKnowledge =
    BuildConfig.DEBUG &&
      ((context as? Activity)?.intent?.getBooleanExtra(DEMO_KNOWLEDGE_EXTRA, false) == true)

  var query by remember { mutableStateOf("") }
  var expandedKeys by remember { mutableStateOf(setOf<String>()) }
  var openDoc by remember { mutableStateOf<KnowledgeOpenDocument?>(null) }
  var railExpanded by remember { mutableStateOf(false) }
  var docBody by remember { mutableStateOf<KnowledgeDocumentBody>(KnowledgeDocumentBody.Loading) }
  var favoriteIds by remember { mutableStateOf(KnowledgeFavoritePrefs.readIds(context)) }
  var searchHits by remember { mutableStateOf<List<KnowledgeSearchHit>>(emptyList()) }
  var searchBusy by remember { mutableStateOf(false) }

  val effectiveCatalog =
    remember(demoKnowledge, catalog) {
      if (demoKnowledge) DEMO_KNOWLEDGE_CATALOG else catalog
    }

  LaunchedEffect(isConnected, demoKnowledge) {
    if (!demoKnowledge && isConnected) {
      viewModel.refreshChatContextCatalog()
    }
  }

  // Web home cockpit uses knowledge.search for the command-bar query.
  LaunchedEffect(query, isConnected, demoKnowledge) {
    val q = query.trim()
    if (demoKnowledge || !isConnected || q.length < 2) {
      searchHits = emptyList()
      searchBusy = false
      return@LaunchedEffect
    }
    searchBusy = true
    delay(280)
    if (query.trim() != q) return@LaunchedEffect
    searchHits =
      try {
        parseKnowledgeSearchResults(
          viewModel.gatewayRequest("knowledge.search", buildKnowledgeSearchParams(q)),
        )
      } catch (_: Throwable) {
        emptyList()
      }
    searchBusy = false
  }

  // Default-expand first level knowledge roots once catalog arrives.
  LaunchedEffect(effectiveCatalog) {
    if (expandedKeys.isEmpty() && effectiveCatalog.isNotEmpty()) {
      expandedKeys =
        effectiveCatalog
          .filter {
            it.type == ChatContextSourceKind.Knowledge || it.type == ChatContextSourceKind.Folder
          }
          .map { contextSourceKey(it) }
          .toSet()
    }
  }

  val tree = remember(effectiveCatalog) { buildContextScopeCatalogTree(effectiveCatalog) }
  val (filtered, searchExpanded) =
    remember(tree, query) { filterContextScopeCatalogTree(tree, query) }
  val visibleExpanded =
    remember(expandedKeys, searchExpanded) { expandedKeys + searchExpanded.toSet() }

  LaunchedEffect(openDoc, isConnected, demoKnowledge) {
    val doc = openDoc ?: return@LaunchedEffect
    railExpanded = false
    val title = doc.item.label
    if (demoKnowledge || !isConnected) {
      docBody = knowledgeDocumentStubBody(title)
      return@LaunchedEffect
    }
    val kbId = doc.knowledgeBaseId
    if (kbId.isNullOrBlank()) {
      docBody = knowledgeDocumentStubBody(title)
      return@LaunchedEffect
    }
    docBody = KnowledgeDocumentBody.Loading
    docBody =
      try {
        val payload =
          viewModel.gatewayRequest(
            method = "knowledge.document.preview",
            paramsJson = buildKnowledgeDocumentPreviewParams(kbId, doc.item.id),
          )
        parseKnowledgeDocumentPreviewPayload(payload, title) ?: knowledgeDocumentStubBody(title)
      } catch (_: Throwable) {
        knowledgeDocumentStubBody(title)
      }
  }

  Box(modifier = modifier.fillMaxSize()) {
    val favoriteItems =
      remember(effectiveCatalog, favoriteIds) {
        effectiveCatalog.filter {
          it.type == ChatContextSourceKind.Knowledge && favoriteIds.contains(it.id)
        }
      }
    KnowledgeTreePane(
      query = query,
      onQueryChange = { query = it },
      filtered = filtered,
      catalogLoading = catalogLoading && effectiveCatalog.isEmpty() && !demoKnowledge,
      isConnected = isConnected || demoKnowledge,
      catalogEmpty = effectiveCatalog.isEmpty(),
      expandedKeys = visibleExpanded,
      favoriteItems = favoriteItems,
      searchHits = searchHits,
      searchBusy = searchBusy,
      onToggleFavorite = { kbId ->
        favoriteIds = KnowledgeFavoritePrefs.toggle(context, kbId)
      },
      onToggleExpand = { key ->
        expandedKeys =
          if (expandedKeys.contains(key)) expandedKeys - key else expandedKeys + key
      },
      onOpenFile = { item ->
        openDoc =
          KnowledgeOpenDocument(
            item = item,
            knowledgeBaseId = resolveKnowledgeBaseId(item, effectiveCatalog),
          )
      },
      onOpenSearchHit = { hit ->
        openDoc =
          KnowledgeOpenDocument(
            item =
              ChatContextSourceCatalogItem(
                type = ChatContextSourceKind.File,
                id = hit.id,
                label = hit.title,
                parentId = hit.knowledgeBaseId,
                visibility = ai.openbot.app.chat.ChatContextVisibility.Private,
              ),
            knowledgeBaseId = hit.knowledgeBaseId,
          )
      },
    )

    val doc = openDoc
    if (doc != null) {
      KnowledgeFullscreenViewer(
        title = doc.item.label,
        body = docBody,
        railExpanded = railExpanded,
        onToggleRail = { railExpanded = !railExpanded },
        onClose = {
          openDoc = null
          railExpanded = false
        },
        filtered = filtered,
        expandedKeys = visibleExpanded,
        onToggleExpand = { key ->
          expandedKeys =
            if (expandedKeys.contains(key)) expandedKeys - key else expandedKeys + key
        },
        onOpenFile = { item ->
          openDoc =
            KnowledgeOpenDocument(
              item = item,
              knowledgeBaseId = resolveKnowledgeBaseId(item, effectiveCatalog),
            )
        },
        activeKey = contextSourceKey(doc.item),
      )
    }
  }
}

@Composable
private fun KnowledgeTreePane(
  query: String,
  onQueryChange: (String) -> Unit,
  filtered: List<ChatContextCatalogGroup>,
  catalogLoading: Boolean,
  isConnected: Boolean,
  catalogEmpty: Boolean,
  expandedKeys: Set<String>,
  favoriteItems: List<ChatContextSourceCatalogItem>,
  searchHits: List<KnowledgeSearchHit>,
  searchBusy: Boolean,
  onToggleFavorite: (String) -> Unit,
  onToggleExpand: (String) -> Unit,
  onOpenFile: (ChatContextSourceCatalogItem) -> Unit,
  onOpenSearchHit: (KnowledgeSearchHit) -> Unit,
) {
  Column(modifier = Modifier.fillMaxSize()) {
    Column(
      modifier =
        Modifier
          .fillMaxWidth()
          .padding(horizontal = mobilePageGutter, vertical = mobilePageVertical),
      verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      // Module header aligned with 任务 / 我的 (MobilePageHeader / HTML .module-title).
      // Search sits *below* the title (HTML SoT fix).
      MobilePageHeader(title = "我的知识库")
      OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
        placeholder = { Text("搜索知识...", style = mobileBody, color = mobileTextTertiary) },
        leadingIcon = {
          Icon(Icons.Default.Search, contentDescription = null, tint = mobileTextTertiary)
        },
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { /* live client filter + knowledge.search */ }),
        shape = RoundedCornerShape(14.dp),
        colors =
          OutlinedTextFieldDefaults.colors(
            focusedContainerColor = Color.White,
            unfocusedContainerColor = Color.White,
            focusedBorderColor = mobileBorder,
            unfocusedBorderColor = mobileBorder,
            focusedTextColor = mobileText,
            unfocusedTextColor = mobileText,
            cursorColor = mobileAccent,
          ),
      )
    }

    when {
      catalogLoading -> {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
          CircularProgressIndicator(color = mobileAccent, modifier = Modifier.size(28.dp))
        }
      }
      !isConnected && catalogEmpty -> {
        // SoT offline chrome: section rails still visible (收藏 / 个人 / 团队 / 企业).
        LazyColumn(
          modifier = Modifier.fillMaxSize(),
          contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
          verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
          item {
            Text(
              text = "未连接网关。连接后加载与 Chat「知识库」相同的个人/团队/企业目录。",
              style = mobileBody,
              color = mobileTextSecondary,
              modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
            )
          }
          item { KnowledgeSectionHeader(label = "收藏", count = 0) }
          item { KnowledgeSectionHeader(label = "个人空间", count = 0) }
          item { KnowledgeSectionHeader(label = "团队空间", count = 0) }
          item { KnowledgeSectionHeader(label = "企业空间", count = 0) }
        }
      }
      catalogEmpty -> {
        Text(
          text = "暂无知识库（需 Gateway 返回 knowledge.base.list / context.scope 目录）",
          style = mobileBody,
          color = mobileTextSecondary,
          modifier = Modifier.padding(horizontal = mobilePageGutter),
        )
      }
      filtered.isEmpty() -> {
        Text(
          text = "无匹配结果",
          style = mobileBody,
          color = mobileTextSecondary,
          modifier = Modifier.padding(horizontal = mobilePageGutter),
        )
      }
      else -> {
        LazyColumn(
          modifier = Modifier.fillMaxSize(),
          contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
          verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
          // SoT / Web: 收藏 funnel from client prefs (knowledge-universe-ui-prefs).
          item(key = "sec-favorites") {
            KnowledgeSectionHeader(label = "收藏", count = favoriteItems.size)
          }
          if (favoriteItems.isEmpty()) {
            item(key = "sec-favorites-empty") {
              Text(
                text = "长按知识库可加入收藏（对齐 Web localStorage favorites）。",
                style = mobileCaption1,
                color = mobileTextTertiary,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
              )
            }
          } else {
            items(favoriteItems, key = { "fav-${it.id}" }) { item ->
              KnowledgeBrowseRow(
                node =
                  ChatContextCatalogNode(
                    item = item,
                    children = emptyList(),
                  ),
                depth = 0,
                expanded = false,
                active = false,
                onToggleExpand = {},
                onOpen = { onToggleExpand(contextSourceKey(item)) },
                onLongPress = { onToggleFavorite(item.id) },
              )
            }
          }
          if (query.trim().length >= 2) {
            item(key = "sec-search") {
              KnowledgeSectionHeader(
                label = "搜索结果",
                count = searchHits.size,
              )
            }
            if (searchBusy) {
              item(key = "sec-search-busy") {
                Text(
                  text = "正在 knowledge.search…",
                  style = mobileCaption1,
                  color = mobileTextTertiary,
                  modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                )
              }
            } else if (searchHits.isEmpty()) {
              item(key = "sec-search-empty") {
                Text(
                  text = "无服务端搜索命中（仍显示下方目录过滤）。",
                  style = mobileCaption1,
                  color = mobileTextTertiary,
                  modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                )
              }
            } else {
              items(searchHits, key = { "hit-${it.id}" }) { hit ->
                Surface(
                  modifier =
                    Modifier
                      .fillMaxWidth()
                      .clickable { onOpenSearchHit(hit) }
                      .padding(horizontal = 8.dp, vertical = 6.dp),
                  color = Color.Transparent,
                ) {
                  Column(Modifier.padding(horizontal = 8.dp, vertical = 4.dp)) {
                    Text(hit.title, style = mobileCallout.copy(fontWeight = FontWeight.SemiBold), color = mobileText)
                    if (hit.summary.isNotBlank()) {
                      Text(
                        hit.summary,
                        style = mobileCaption1,
                        color = mobileTextSecondary,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                      )
                    }
                  }
                }
              }
            }
          }
          for (group in filtered) {
            val count = countLeafish(group.nodes)
            item(key = "sec-${group.visibility}") {
              KnowledgeSectionHeader(
                label = knowledgeBrowserSectionLabel(group.visibility),
                count = count,
              )
            }
            items(
              flattenVisibleCatalogNodes(group.nodes, expandedKeys),
              key = { contextSourceKey(it.node.item) + ":${it.depth}" },
            ) { row ->
              KnowledgeBrowseRow(
                node = row.node,
                depth = row.depth,
                expanded = expandedKeys.contains(contextSourceKey(row.node.item)),
                active = false,
                onToggleExpand = { onToggleExpand(contextSourceKey(row.node.item)) },
                onOpen = {
                  val item = row.node.item
                  when (item.type) {
                    ChatContextSourceKind.File -> onOpenFile(item)
                    ChatContextSourceKind.Folder,
                    ChatContextSourceKind.Knowledge,
                    -> onToggleExpand(contextSourceKey(item))
                    else -> Unit
                  }
                },
                onLongPress = {
                  val item = row.node.item
                  if (item.type == ChatContextSourceKind.Knowledge) {
                    onToggleFavorite(item.id)
                  }
                },
              )
            }
          }
          item { Spacer(Modifier.height(24.dp)) }
        }
      }
    }
  }
}

@Composable
private fun KnowledgeFullscreenViewer(
  title: String,
  body: KnowledgeDocumentBody,
  railExpanded: Boolean,
  onToggleRail: () -> Unit,
  onClose: () -> Unit,
  filtered: List<ChatContextCatalogGroup>,
  expandedKeys: Set<String>,
  onToggleExpand: (String) -> Unit,
  onOpenFile: (ChatContextSourceCatalogItem) -> Unit,
  activeKey: String,
) {
  Surface(
    modifier = Modifier.fillMaxSize(),
    color = Color.White,
  ) {
    Column(Modifier.fillMaxSize()) {
      Row(
        modifier =
          Modifier
            .fillMaxWidth()
            .height(48.dp)
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
      ) {
        Surface(
          onClick = onClose,
          shape = CircleShape,
          color = Color.White,
          border = BorderStroke(1.dp, mobileBorder),
          modifier = Modifier.size(32.dp),
        ) {
          Box(contentAlignment = Alignment.Center) {
            Icon(
              Icons.AutoMirrored.Filled.ArrowBack,
              contentDescription = "返回",
              tint = mobileText,
              modifier = Modifier.size(18.dp),
            )
          }
        }
        Text(
          text = title,
          style = mobileHeadline.copy(fontWeight = FontWeight.SemiBold),
          color = mobileText,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
          modifier = Modifier.weight(1f),
          textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        Surface(
          onClick = onClose,
          shape = CircleShape,
          color = Color.White,
          border = BorderStroke(1.dp, mobileBorder),
          modifier = Modifier.size(32.dp),
        ) {
          Box(contentAlignment = Alignment.Center) {
            Icon(Icons.Default.Close, contentDescription = "关闭", tint = mobileText, modifier = Modifier.size(16.dp))
          }
        }
      }
      Box(
        Modifier
          .fillMaxWidth()
          .height(1.dp)
          .background(mobileBorder),
      )

      // HTML SoT lock: fullscreen doc = unified white body, no left rail / red strip.
      // (knowledge-fullscreen.jpg rail is superseded by interactive index.html.)
      // Rail affordance removed for HTML SoT parity; keep params to avoid call-site churn.
      if (false) {
        onToggleRail()
        onToggleExpand("")
        filtered.forEach { g -> g.nodes.forEach { onOpenFile(it.item) } }
        println(railExpanded.toString() + expandedKeys.size + activeKey)
      }
      Column(
        modifier =
          Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 22.dp, vertical = 22.dp),
      ) {
          when (val b = body) {
            is KnowledgeDocumentBody.Loading -> {
              Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = mobileAccent, modifier = Modifier.size(28.dp))
              }
            }
            is KnowledgeDocumentBody.Unavailable -> {
              Text(b.title, style = mobileTitle2.copy(fontWeight = FontWeight.Bold), color = mobileText)
              Spacer(Modifier.height(12.dp))
              Text(b.reason, style = mobileBody, color = mobileTextSecondary)
            }
            is KnowledgeDocumentBody.Text -> {
              Text(
                text = b.title,
                style = mobileTitle2.copy(fontWeight = FontWeight.Bold, fontSize = 22.sp),
                color = Color(0xFF111827),
              )
              Spacer(Modifier.height(16.dp))
              val html = b.htmlSource
              if (!html.isNullOrBlank()) {
                KnowledgeHtmlPreview(html = html, modifier = Modifier.fillMaxWidth().height(420.dp))
                Spacer(Modifier.height(12.dp))
                Text(
                  text = "HTML 预览（Web knowledge.document.preview renderKind=html）",
                  style = mobileCaption1,
                  color = mobileTextTertiary,
                )
              } else {
                KnowledgeDocParagraphs(b.markdownOrPlain)
              }
              if (!b.fromPreview) {
                Spacer(Modifier.height(20.dp))
                Text(
                  text = "占位预览 · 与 Web knowledge.document.preview 对齐后显示原文",
                  style = mobileCaption1,
                  color = mobileTextTertiary,
                )
              }
            }
          }
          Spacer(Modifier.height(96.dp))
      }
    }
  }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun KnowledgeHtmlPreview(html: String, modifier: Modifier = Modifier) {
  AndroidView(
    modifier = modifier,
    factory = { ctx ->
      WebView(ctx).apply {
        webViewClient = WebViewClient()
        settings.javaScriptEnabled = false
        settings.domStorageEnabled = false
        loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
      }
    },
    update = { view ->
      view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
    },
  )
}

@Composable
private fun KnowledgeDocParagraphs(raw: String) {
  val blocks =
    remember(raw) {
      raw
        .lines()
        .fold(mutableListOf<String>() to StringBuilder()) { (acc, buf), line ->
          val trimmed = line.trimEnd()
          if (trimmed.isBlank()) {
            if (buf.isNotEmpty()) {
              acc.add(buf.toString().trim())
              buf.clear()
            }
          } else {
            if (buf.isNotEmpty()) buf.append('\n')
            buf.append(trimmed)
          }
          acc to buf
        }.let { (acc, buf) ->
          if (buf.isNotEmpty()) acc.add(buf.toString().trim())
          acc.filter { it.isNotBlank() }.map { b ->
            if (b.trimStart().startsWith("#")) b.trimStart().trimStart('#').trim() else b
          }
        }
    }
  val heading =
    remember(raw) {
      raw.lineSequence().firstOrNull { it.trimStart().startsWith("#") }?.trimStart()?.trimStart('#')?.trim()
    }
  // Title already rendered from body.title; skip duplicate H1 if present in text.
  var skippedTitle = heading == null
  for (block in blocks) {
    val isHeading = block.lines().size == 1 && block.length < 40 && !block.contains("。")
    if (!skippedTitle && block == heading) {
      skippedTitle = true
      continue
    }
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
      if (isHeading || block.matches(Regex("^\\d+\\.\\s*.+"))) {
        Text(
          text = block,
          style = mobileBody.copy(fontWeight = FontWeight.Bold),
          color = Color(0xFF111827),
        )
      } else {
        Text(
          text = block,
          style = mobileBody.copy(lineHeight = 26.sp),
          color = Color(0xFF374151),
        )
      }
    }
  }
}

@Composable
private fun KnowledgeSectionHeader(label: String, count: Int) {
  Row(
    modifier =
      Modifier
        .fillMaxWidth()
        .padding(horizontal = 8.dp, vertical = 10.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Text(
      text = label,
      style = mobileBody.copy(fontWeight = FontWeight.SemiBold),
      color = mobileText,
      modifier = Modifier.weight(1f),
    )
    Text(
      text = count.toString(),
      style = mobileCaption1.copy(fontWeight = FontWeight.Medium),
      color = mobileTextTertiary,
    )
  }
}

@Composable
@OptIn(ExperimentalFoundationApi::class)
internal fun KnowledgeBrowseRow(
  node: ChatContextCatalogNode,
  depth: Int,
  expanded: Boolean,
  active: Boolean,
  onToggleExpand: () -> Unit,
  onOpen: () -> Unit,
  compact: Boolean = false,
  onLongPress: (() -> Unit)? = null,
) {
  val item = node.item
  val hasChildren = node.children.isNotEmpty()
  val isFile = item.type == ChatContextSourceKind.File
  val padStart = if (compact) (6 + depth * 10).dp else (8 + depth * 14).dp
  Row(
    modifier =
      Modifier
        .fillMaxWidth()
        .background(if (active) Color(0xFFEFF6FF) else Color.Transparent)
        .then(
          if (onLongPress != null) {
            Modifier.combinedClickable(onClick = onOpen, onLongClick = onLongPress)
          } else {
            Modifier.clickable(onClick = onOpen)
          },
        )
        .padding(start = padStart, end = 8.dp, top = if (compact) 6.dp else 8.dp, bottom = if (compact) 6.dp else 8.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    if (hasChildren || item.type == ChatContextSourceKind.Knowledge || item.type == ChatContextSourceKind.Folder) {
      Surface(onClick = onToggleExpand, shape = RoundedCornerShape(4.dp), color = Color.Transparent) {
        Icon(
          imageVector = if (expanded) Icons.Default.ExpandMore else Icons.AutoMirrored.Filled.KeyboardArrowRight,
          contentDescription = if (expanded) "折叠" else "展开",
          tint = mobileTextSecondary,
          modifier = Modifier.size(if (compact) 16.dp else 18.dp),
        )
      }
    } else {
      Spacer(Modifier.size(if (compact) 16.dp else 18.dp))
    }
    if (!isFile) {
      Box(
        modifier =
          Modifier
            .size(7.dp)
            .background(Color(0xFF10B981), CircleShape),
      )
    }
    Icon(
      imageVector = if (isFile) Icons.AutoMirrored.Filled.InsertDriveFile else Icons.Default.Folder,
      contentDescription = null,
      tint = mobileTextSecondary,
      modifier = Modifier.size(if (compact) 14.dp else 16.dp),
    )
    Text(
      text = item.label,
      style =
        mobileBody.copy(
          fontWeight = if (isFile) FontWeight.Medium else FontWeight.SemiBold,
          fontSize = if (compact) 12.sp else 13.sp,
        ),
      color = mobileText,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
      modifier = Modifier.weight(1f),
    )
  }
}

/** SoT section badge = top-level libraries in the visibility group. */
private fun countLeafish(nodes: List<ChatContextCatalogNode>): Int = nodes.size
