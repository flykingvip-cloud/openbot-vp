package ai.openbot.app.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import ai.openbot.app.MainViewModel

@Composable
fun RootScreen(
  viewModel: MainViewModel,
  employeeSessionActive: Boolean = false,
  onOpenEmployeeWorkbench: (() -> Unit)? = null,
) {
  val onboardingCompleted by viewModel.onboardingCompleted.collectAsState()

  // A valid employee session skips node onboarding. Post-login chrome is the
  // four-tab companion, not the pairing wizard.
  if (!employeeSessionActive && !onboardingCompleted) {
    OnboardingFlow(viewModel = viewModel, modifier = Modifier.fillMaxSize())
    return
  }

  PostOnboardingTabs(
    viewModel = viewModel,
    onOpenEmployeeWorkbench = onOpenEmployeeWorkbench,
    modifier = Modifier.fillMaxSize(),
  )
}
