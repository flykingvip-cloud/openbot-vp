package ai.openbot.app.ui.chat

import android.app.Activity
import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import ai.openbot.app.BuildConfig
import ai.openbot.app.MainViewModel
import ai.openbot.app.chat.ChatAgentEntry
import ai.openbot.app.chat.ChatSessionEntry
import ai.openbot.app.chat.ChatMessage
import ai.openbot.app.chat.ChatMessageContent
import ai.openbot.app.chat.OutgoingAttachment
import ai.openbot.app.chat.toChatSendContextScope
import ai.openbot.app.chat.DEFAULT_CHAT_CONTEXT_SCOPE
import ai.openbot.app.chat.ChatContextScopeState
import ai.openbot.app.ui.VoiceTabScreen
import ai.openbot.app.ui.mobilePageGutter
import ai.openbot.app.ui.mobilePageVertical
import ai.openbot.app.ui.mobileText
import java.io.ByteArrayOutputStream
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Debug evidence only — multi-agent strip without gateway. Not a routing change. */
const val DEMO_AGENT_STRIP_EXTRA = "ai.openbot.app.extra.DEMO_AGENT_STRIP"

/** Debug evidence only — seed IMG_1711-style table + declared deliverable footer (url open). */
const val DEMO_DELIVERABLE_EXTRA = "ai.openbot.app.extra.DEMO_DELIVERABLE"

/** Debug evidence only — file-only envelope → disabled 「打开成果」 + unavailable copy. */
const val DEMO_DELIVERABLE_FILE_EXTRA = "ai.openbot.app.extra.DEMO_DELIVERABLE_FILE"

/** Offline fixture matching IMG_1711 table + deliverable footer (url= → Custom Tabs). */
internal val DEMO_DELIVERABLE_MESSAGE_TEXT =
  """
  | 要点 | 关键词 | 回答的问题 |
  | --- | --- | --- |
  | 一 | 变化 | 听众要感知什么趋势？ |
  | 二 | 决策 | 听众要带走什么判断？ |
  | 三 | 行动 | 听众下一步做什么？ |

  **一**抓住「变化」：先对齐听众对趋势的共识。
  **二**落到「决策」：用一句可复述的判断收束。
  **三**给出「行动」：留下可执行的下一步。

  <<DELIVERABLE title="演讲三大要点设计" url="https://example.com/openbot-demo-deliverable">>
  <</DELIVERABLE>>
  """.trimIndent()

/** Offline fixture: located file= only — CTA disabled (no workspace open path). */
internal val DEMO_DELIVERABLE_FILE_MESSAGE_TEXT =
  """
  已生成本地讲稿草稿（尚无外链）。

  <<DELIVERABLE title="演讲三大要点设计" file="output/speech-outline.md">>
  <</DELIVERABLE>>
  """.trimIndent()

/** Offline strip→session transcripts (mirrors Web preview chatBySession). */
internal fun demoStripMessagesForSession(sessionKey: String): List<ChatMessage> {
  val key = sessionKey.trim().ifEmpty { "main" }
  fun assistant(id: String, text: String, ts: Long) =
    ChatMessage(
      id = id,
      role = "assistant",
      content = listOf(ChatMessageContent(type = "text", text = text)),
      timestampMs = ts,
    )
  fun user(id: String, text: String, ts: Long) =
    ChatMessage(
      id = id,
      role = "user",
      content = listOf(ChatMessageContent(type = "text", text = text)),
      timestampMs = ts,
    )
  return when {
    key == "main" || key == "agent:main" || key == "agent:main:main" ->
      listOf(
        assistant(
          "demo-main-1",
          "你好，我是${BUILTIN_STEWARD_NAME}。需要我协调其他助手或协作组时，点上方条切换会话。",
          1_700_000_000_000L,
        ),
      )
    key == "agent:assistant-a:main" || key.endsWith("assistant-a:main") || key == "agent:market:main" ->
      listOf(
        assistant("demo-a-1", "你好，我是 OpenBot 智能助理。有什么可以帮助你的吗？", 1_700_000_000_100L),
        user("demo-a-2", "帮我查一下最新产品规格中关于接口兼容性的说明", 1_700_000_000_200L),
        assistant(
          "demo-a-3",
          "好的，已为你找到相关内容：接口兼容性说明请见《产品规格书 v2.3》3.2.1 节。",
          1_700_000_000_300L,
        ),
      )
    key == "agent:assistant-b:main" || key.endsWith("assistant-b:main") ->
      listOf(
        assistant("demo-b-1", "助手乙在线。我可以帮你做导航、指引与待办分流。", 1_700_000_000_150L),
      )
    key.startsWith("space:") || key.startsWith("group:") ->
      listOf(
        assistant("demo-space-1", "协作组会话。成员消息与机器人回复会出现在此线程。", 1_700_000_000_050L),
      )
    else ->
      listOf(
        assistant("demo-other-1", "这是会话「$key」的消息页。", 1_700_000_000_000L),
      )
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatSheetContent(viewModel: MainViewModel) {
  val messages by viewModel.chatMessages.collectAsState()
  val pendingRunCount by viewModel.pendingRunCount.collectAsState()
  val healthOk by viewModel.chatHealthOk.collectAsState()
  val sessionKey by viewModel.chatSessionKey.collectAsState()
  val mainSessionKey by viewModel.mainSessionKey.collectAsState()
  val thinkingLevel by viewModel.chatThinkingLevel.collectAsState()
  val streamingAssistantText by viewModel.chatStreamingAssistantText.collectAsState()
  val pendingToolCalls by viewModel.chatPendingToolCalls.collectAsState()
  val sessions by viewModel.chatSessions.collectAsState()
  val agents by viewModel.chatAgents.collectAsState()
  val contextCatalog by viewModel.chatContextSourceCatalog.collectAsState()
  val contextCatalogLoading by viewModel.chatContextCatalogLoading.collectAsState()

  LaunchedEffect(mainSessionKey) {
    viewModel.loadChat(mainSessionKey)
    viewModel.refreshChatSessions(limit = 200)
  }

  val context = LocalContext.current
  // Debug-only evidence seed (DEMO_AGENT_STRIP): multi-assistant strip without gateway.
  // Production / release never seeds fake assistants — roster stays agents.list.
  val demoAgentStrip =
    BuildConfig.DEBUG &&
      ((context as? Activity)?.intent?.getBooleanExtra(DEMO_AGENT_STRIP_EXTRA, false) == true)
  val effectiveAgents =
    remember(agents, demoAgentStrip) {
      if (agents.isNotEmpty()) {
        agents
      } else if (demoAgentStrip) {
        listOf(
          ChatAgentEntry(id = "main", name = BUILTIN_STEWARD_NAME, isDefault = true),
          ChatAgentEntry(id = "assistant-a", name = "助手甲", isDefault = false),
          ChatAgentEntry(id = "assistant-b", name = "助手乙", isDefault = false),
        )
      } else {
        agents
      }
    }

  // Demo spaces so strip→session binding can switch collab threads offline.
  val effectiveSessions =
    remember(sessions, demoAgentStrip) {
      if (sessions.isNotEmpty()) {
        sessions
      } else if (demoAgentStrip) {
        listOf(
          ChatSessionEntry(key = "main", updatedAtMs = 1L, displayName = BUILTIN_STEWARD_NAME),
          ChatSessionEntry(key = "agent:assistant-a:main", updatedAtMs = 1L, displayName = "助手甲"),
          ChatSessionEntry(key = "agent:assistant-b:main", updatedAtMs = 1L, displayName = "助手乙"),
          ChatSessionEntry(key = "space:collab-a", updatedAtMs = 1L, displayName = "协作组A"),
        )
      } else {
        sessions
      }
    }

  // Debug-only evidence seed (DEMO_DELIVERABLE): table + footer without gateway.
  val demoDeliverable =
    BuildConfig.DEBUG &&
      ((context as? Activity)?.intent?.getBooleanExtra(DEMO_DELIVERABLE_EXTRA, false) == true)
  val demoDeliverableFile =
    BuildConfig.DEBUG &&
      ((context as? Activity)?.intent?.getBooleanExtra(DEMO_DELIVERABLE_FILE_EXTRA, false) == true)
  val effectiveMessages =
    remember(messages, demoDeliverable, demoDeliverableFile, demoAgentStrip, sessionKey) {
      when {
        // DEMO strip: always bind transcript to sessionKey (Web strip→session), even offline.
        demoAgentStrip -> demoStripMessagesForSession(sessionKey)
        messages.isNotEmpty() -> messages
        demoDeliverableFile ->
          listOf(
            ChatMessage(
              id = "demo-deliverable-file",
              role = "assistant",
              content =
                listOf(
                  ChatMessageContent(type = "text", text = DEMO_DELIVERABLE_FILE_MESSAGE_TEXT),
                ),
              timestampMs = null,
            ),
          )
        demoDeliverable ->
          listOf(
            ChatMessage(
              id = "demo-deliverable",
              role = "assistant",
              content =
                listOf(
                  ChatMessageContent(type = "text", text = DEMO_DELIVERABLE_MESSAGE_TEXT),
                ),
              timestampMs = null,
            ),
          )
        else -> messages
      }
    }

  val stripModel =
    remember(sessionKey, effectiveAgents, effectiveSessions, mainSessionKey) {
      buildAgentStripNavModel(
        agents = effectiveAgents,
        sessions = effectiveSessions,
        activeSessionKey = sessionKey,
        mainSessionKey = mainSessionKey,
      )
    }
  // HTML SoT omits TO: header; strip selection still drives sessionKey.
  val resolver = context.contentResolver
  val scope = rememberCoroutineScope()

  val attachments = remember { mutableStateListOf<PendingChatAttachment>() }
  var contextScope by remember { mutableStateOf(DEFAULT_CHAT_CONTEXT_SCOPE) }
  var knowledgePickerOpen by remember { mutableStateOf(false) }
  // Web chat mic is disabled; Android wires the same affordance to TalkMode/MicCapture
  // (VoiceTabScreen → chat.send), not a parallel STT-in-composer stack.
  var voiceOverlayOpen by rememberSaveable { mutableStateOf(false) }

  LaunchedEffect(voiceOverlayOpen) {
    viewModel.setVoiceScreenActive(voiceOverlayOpen)
  }
  DisposableEffect(Unit) {
    onDispose { viewModel.setVoiceScreenActive(false) }
  }
  BackHandler(enabled = voiceOverlayOpen) {
    voiceOverlayOpen = false
  }

  val pickAttachments =
    rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
      if (uris.isNullOrEmpty()) return@rememberLauncherForActivityResult
      val room = (ChatAttachmentLimits.MAX_COUNT - attachments.size).coerceAtLeast(0)
      if (room == 0) return@rememberLauncherForActivityResult
      val selected = uris.take(room)
      scope.launch(Dispatchers.IO) {
        for (uri in selected) {
          val placeholderId = uri.toString() + "#" + UUID.randomUUID()
          val provisionalName = queryDisplayName(resolver, uri) ?: uri.lastPathSegment?.substringAfterLast('/') ?: "attachment"
          withContext(Dispatchers.Main) {
            attachments.add(
              PendingChatAttachment(
                id = placeholderId,
                fileName = provisionalName,
                mimeType = resolver.getType(uri) ?: "application/octet-stream",
                type = "file",
                status = PendingAttachmentStatus.Reading,
                progressPercent = 8,
              ),
            )
          }
          val loaded = loadChatAttachment(resolver, uri, placeholderId)
          withContext(Dispatchers.Main) {
            val idxAtt = attachments.indexOfFirst { it.id == placeholderId }
            if (idxAtt >= 0) {
              attachments[idxAtt] = loaded
            }
          }
        }
      }
    }

  Box(modifier = Modifier.fillMaxSize()) {
    Column(
      modifier = Modifier.fillMaxSize(),
      verticalArrangement = Arrangement.spacedBy(0.dp),
    ) {
      // HTML SoT `.agent-strip`: edge-to-edge white rail + bottom hairline; icon-above-name chips.
      Column(modifier = Modifier.fillMaxWidth()) {
        ChatAgentStrip(
          model = stripModel,
          onSelect = { key -> viewModel.switchChatSession(key) },
        )
        Box(
          Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(Color(0xFFEEF0F3)),
        )
      }

      // Stage 2.6: ChatErrorRail not rendered (errors stay in chatError flow for diagnostics).
      // HTML four-tab SoT has no TO: stage header between strip and messages.

      var pullRefreshing by remember { mutableStateOf(false) }
      PullToRefreshBox(
        isRefreshing = pullRefreshing,
        onRefresh = {
          pullRefreshing = true
          viewModel.pullToReconnectChat()
          scope.launch {
            delay(900)
            pullRefreshing = false
          }
        },
        modifier =
          Modifier
            .weight(1f, fill = true)
            .padding(horizontal = mobilePageGutter)
            .padding(top = 8.dp),
      ) {
        ChatMessageListCard(
          messages = effectiveMessages,
          pendingRunCount = pendingRunCount,
          pendingToolCalls = pendingToolCalls,
          streamingAssistantText = streamingAssistantText,
          healthOk = healthOk,
          modifier = Modifier.fillMaxSize(),
        )
      }

      // Web SoT: pink「知识库」capsule above white pill composer (chat-context-scope picker).
      // HTML `.capsules { padding-bottom: 8px }` — isolate from parent spacedBy.
      Column(
        modifier =
          Modifier
            .fillMaxWidth()
            .padding(horizontal = mobilePageGutter)
            .padding(bottom = mobilePageVertical),
      ) {
        KnowledgeCapsuleRow(
          scope = contextScope,
          onOpenPicker = {
            knowledgePickerOpen = true
            contextScope = contextScope.copy(pickerOpen = true)
          },
          modifier = Modifier.padding(bottom = 8.dp),
        )
        Row(modifier = Modifier.fillMaxWidth().imePadding()) {
          ChatComposer(
            healthOk = healthOk,
            pendingRunCount = pendingRunCount,
            attachments = attachments,
            onPickAttachments = { pickAttachments.launch(CHAT_ATTACHMENT_MIME_TYPES) },
            onRemoveAttachment = { id -> attachments.removeAll { it.id == id } },
            onAbort = { viewModel.abortChat() },
            onMicClick = { voiceOverlayOpen = true },
            onSend = { text ->
              val outgoing =
                attachments
                  .filter { it.status == PendingAttachmentStatus.Ready && !it.base64.isNullOrEmpty() }
                  .map { att ->
                    OutgoingAttachment(
                      type = att.type,
                      mimeType = att.mimeType,
                      fileName = att.fileName,
                      base64 = att.base64!!,
                    )
                  }
              val payload = toChatSendContextScope(contextScope, sessionKey, contextCatalog)
              viewModel.sendChat(
                message = text,
                thinking = thinkingLevel,
                attachments = outgoing,
                contextScope = payload,
              )
              attachments.clear()
              // Web turn lifetime: clear one-shot sources after send when lifetime=turn.
              if (contextScope.lifetime == ai.openbot.app.chat.ChatContextLifetime.Turn &&
                contextScope.selectedSources.isNotEmpty()
              ) {
                contextScope =
                  contextScope.copy(
                    selectedSources = emptyList(),
                    preset = ai.openbot.app.chat.ChatContextPreset.Auto,
                  )
              }
            },
          )
        }
      }

      KnowledgeScopePickerSheet(
        open = knowledgePickerOpen,
        scope = contextScope,
        catalog = contextCatalog,
        loading = contextCatalogLoading,
        onDismiss = {
          knowledgePickerOpen = false
          contextScope = contextScope.copy(pickerOpen = false)
        },
        onScopeChange = { contextScope = it },
        onEnsureCatalog = { viewModel.refreshChatContextCatalog() },
      )
    }

    if (voiceOverlayOpen) {
      // Same Voice/TalkMode path as 我的→语音对话 (MicCapture → chat.send + TalkMode TTS).
      Surface(modifier = Modifier.fillMaxSize(), color = Color.White) {
        Column(modifier = Modifier.fillMaxSize()) {
          Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            IconButton(onClick = { voiceOverlayOpen = false }) {
              Icon(
                Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "返回对话",
                tint = mobileText,
              )
            }
            Text(
              text = "语音对话",
              color = mobileText,
              fontWeight = FontWeight.SemiBold,
            )
          }
          VoiceTabScreen(viewModel = viewModel)
        }
      }
    }
  }
}

private fun queryDisplayName(resolver: ContentResolver, uri: Uri): String? {
  return try {
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
      if (!cursor.moveToFirst()) return@use null
      val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
      if (idx < 0) null else cursor.getString(idx)?.trim()?.takeIf { it.isNotEmpty() }
    }
  } catch (_: Throwable) {
    null
  }
}

private fun querySizeBytes(resolver: ContentResolver, uri: Uri): Long? {
  return try {
    resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
      if (!cursor.moveToFirst()) return@use null
      val idx = cursor.getColumnIndex(OpenableColumns.SIZE)
      if (idx < 0) null else cursor.getLong(idx).takeIf { it >= 0 }
    }
  } catch (_: Throwable) {
    null
  }
}

private suspend fun loadChatAttachment(
  resolver: ContentResolver,
  uri: Uri,
  id: String,
): PendingChatAttachment {
  val mimeType = resolver.getType(uri) ?: "application/octet-stream"
  val fileName =
    queryDisplayName(resolver, uri)
      ?: (uri.lastPathSegment ?: "attachment").substringAfterLast('/')
  if (!isSupportedChatAttachment(mimeType, fileName)) {
    return PendingChatAttachment(
      id = id,
      fileName = fileName,
      mimeType = mimeType,
      type = chatAttachmentTransportType(mimeType),
      status = PendingAttachmentStatus.Failed,
      error = "不支持的文件类型",
    )
  }
  val sizeHint = querySizeBytes(resolver, uri)
  val maxBytes = chatAttachmentMaxBytes(mimeType)
  if (sizeHint != null && sizeHint > maxBytes) {
    return PendingChatAttachment(
      id = id,
      fileName = fileName,
      mimeType = mimeType,
      type = chatAttachmentTransportType(mimeType),
      status = PendingAttachmentStatus.Failed,
      error = "超过大小限制 (${maxBytes / (1024 * 1024)}MB)",
      sizeBytes = sizeHint,
    )
  }
  val bytes =
    withContext(Dispatchers.IO) {
      resolver.openInputStream(uri)?.use { input ->
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
          val n = input.read(buffer)
          if (n <= 0) break
          total += n
          if (total > maxBytes) {
            return@use null
          }
          out.write(buffer, 0, n)
        }
        out.toByteArray()
      }
    }
  if (bytes == null) {
    return PendingChatAttachment(
      id = id,
      fileName = fileName,
      mimeType = mimeType,
      type = chatAttachmentTransportType(mimeType),
      status = PendingAttachmentStatus.Failed,
      error = "超过大小限制 (${maxBytes / (1024 * 1024)}MB)",
      sizeBytes = sizeHint,
    )
  }
  if (bytes.isEmpty()) {
    return PendingChatAttachment(
      id = id,
      fileName = fileName,
      mimeType = mimeType,
      type = chatAttachmentTransportType(mimeType),
      status = PendingAttachmentStatus.Failed,
      error = "空文件",
    )
  }
  val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
  return PendingChatAttachment(
    id = id,
    fileName = fileName,
    mimeType = mimeType,
    type = chatAttachmentTransportType(mimeType),
    base64 = base64,
    status = PendingAttachmentStatus.Ready,
    progressPercent = 100,
    sizeBytes = bytes.size.toLong(),
  )
}
