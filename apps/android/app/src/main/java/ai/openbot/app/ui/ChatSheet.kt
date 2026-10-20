package ai.openbot.app.ui

import androidx.compose.runtime.Composable
import ai.openbot.app.MainViewModel
import ai.openbot.app.ui.chat.ChatSheetContent

@Composable
fun ChatSheet(viewModel: MainViewModel) {
  ChatSheetContent(viewModel = viewModel)
}
