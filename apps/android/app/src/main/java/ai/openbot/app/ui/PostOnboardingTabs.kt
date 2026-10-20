package ai.openbot.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ai.openbot.app.MainViewModel
import ai.openbot.app.chat.OutgoingAttachment

private enum class HomeTab(
  val label: String,
  val icon: ImageVector,
) {
  // SoT tabbar: 💬 / ☑ / 📖 / 👤
  Chat(label = "对话", icon = Icons.Default.ChatBubble),
  Tasks(label = "任务", icon = Icons.Default.CheckBox),
  Knowledge(label = "知识", icon = Icons.AutoMirrored.Filled.MenuBook),
  Me(label = "我的", icon = Icons.Default.Person),
}

/**
 * Post-login main chrome: 对话 / 任务 / 知识 / 我的.
 * Knowledge stays a stub. This is not the web Employee Shell five-module bar.
 */
@Composable
fun PostOnboardingTabs(
  viewModel: MainViewModel,
  modifier: Modifier = Modifier,
  onOpenEmployeeWorkbench: (() -> Unit)? = null,
) {
  var activeTab by rememberSaveable { mutableStateOf(HomeTab.Chat) }
  var voiceActive by rememberSaveable { mutableStateOf(false) }

  LaunchedEffect(activeTab, voiceActive) {
    viewModel.setVoiceScreenActive(activeTab == HomeTab.Me && voiceActive)
  }

  // Connection logic kept (isConnected gates task/knowledge → chat prompts).
  // Stage 2.6: do not render TopStatusBar / offline chip chrome.
  val isConnected by viewModel.isConnected.collectAsState()

  val density = LocalDensity.current
  val imeVisible = WindowInsets.ime.getBottom(density) > 0
  val hideBottomTabBar = activeTab == HomeTab.Chat && imeVisible

  fun openChatWithPrompt(prompt: String) {
    activeTab = HomeTab.Chat
    if (isConnected) {
      viewModel.sendChat(message = prompt, thinking = "low", attachments = emptyList<OutgoingAttachment>())
    }
  }

  Scaffold(
    modifier = modifier,
    containerColor = Color.Transparent,
    contentWindowInsets = WindowInsets(0, 0, 0, 0),
    bottomBar = {
      if (!hideBottomTabBar) {
        BottomTabBar(
          activeTab = activeTab,
          onSelect = { activeTab = it },
        )
      }
    },
  ) { innerPadding ->
    val topSafe = WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal)
    Box(
      modifier =
        Modifier
          .fillMaxSize()
          .padding(innerPadding)
          .consumeWindowInsets(innerPadding)
          .windowInsetsPadding(topSafe)
          .background(mobileBackgroundGradient),
    ) {
      when (activeTab) {
        HomeTab.Chat -> ChatSheet(viewModel = viewModel)
        HomeTab.Tasks ->
          MobileTasksScreen(
            viewModel = viewModel,
            onOpenChat = ::openChatWithPrompt,
          )
        HomeTab.Knowledge ->
          MobileKnowledgeScreen(
            viewModel = viewModel,
            onOpenChat = ::openChatWithPrompt,
          )
        HomeTab.Me ->
          MeTabScreen(
            viewModel = viewModel,
            onVoiceActiveChange = { voiceActive = it },
            onOpenEmployeeWorkbench = onOpenEmployeeWorkbench,
          )
      }
    }
  }
}

@Composable
private fun BottomTabBar(
  activeTab: HomeTab,
  onSelect: (HomeTab) -> Unit,
) {
  val safeInsets = WindowInsets.navigationBars.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal)

  Box(
    modifier = Modifier.fillMaxWidth(),
  ) {
    Surface(
      modifier = Modifier.fillMaxWidth(),
      color = Color.White.copy(alpha = 0.97f),
      shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
      border = BorderStroke(1.dp, mobileBorder),
      shadowElevation = 6.dp,
    ) {
      Row(
        modifier =
          Modifier
            .fillMaxWidth()
            .windowInsetsPadding(safeInsets)
            .padding(horizontal = 10.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        HomeTab.entries.forEach { tab ->
          val active = tab == activeTab
          Surface(
            onClick = { onSelect(tab) },
            modifier = Modifier.weight(1f).heightIn(min = 58.dp),
            shape = RoundedCornerShape(16.dp),
            color = Color.Transparent,
            shadowElevation = 0.dp,
          ) {
            Column(
              modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 7.dp),
              horizontalAlignment = Alignment.CenterHorizontally,
              verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
              Icon(
                imageVector = tab.icon,
                contentDescription = tab.label,
                tint = if (active) mobileAccent else mobileTextTertiary,
              )
              Text(
                text = tab.label,
                color = if (active) mobileAccent else mobileTextSecondary,
                style = mobileCaption2.copy(fontWeight = if (active) FontWeight.Bold else FontWeight.Medium),
              )
            }
          }
        }
      }
    }
  }
}
