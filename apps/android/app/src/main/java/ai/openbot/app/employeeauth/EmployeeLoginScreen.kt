package ai.openbot.app.employeeauth

import ai.openbot.app.R
import ai.openbot.app.account.Account
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

//
// Cold-start employee auth (visual + flow counterpart of
// apps/macos/.../PlatformAuth/PlatformAuthView.swift).
//
// Login | register stay on a segmented control. Forgot password continues into
// a code + new-password reset, then a successful reset signs in and the host
// opens the Employee Shell WebView. Gateway URL is fixed to the cloud default
// and is not shown. This screen does not offer SSO or a multi-account switcher.
//
// Palette is the Mac warm stone / charcoal gold set, not Material dynamic color.
// The selected segment uses the green from the PlatformAuth reference card.
//

private object EmployeeLoginPalette {
  val background = Color(0xFFF6F5F2)
  val ink = Color(0xFF24211F)
  val muted = Color(0xFF736E66)
  val accent = Color(0xFF8C6629)
  val fieldFill = Color.White.copy(alpha = 0.72f)
  val fieldStroke = Color(0xFFDBD6CC)
  val error = Color(0xFFB8382E)
  val segmentSelected = Color(0xFF34C759)
  val segmentTrack = Color(0xFFE7E4DE)
  val onSegmentSelected = Color.White

  /** Accent at 0.45 over the stone background, as a flat fill. */
  val accentDisabled = Color(0xFFC6B597)
}

/** Native pixels of drawable-nodpi/openbot_auth_logo.png. The file keeps its alpha. */
private const val AUTH_LOGO_ASPECT = 1536f / 1024f

@Composable
fun EmployeeLoginScreen(
  controller: EmployeeShellController,
  onLoggedIn: (Account) -> Unit,
  modifier: Modifier = Modifier,
) {
  val scope = rememberCoroutineScope()
  val forgotSentMessage = stringResource(R.string.employee_login_forgot_sent)
  val forgotDevTemplate = stringResource(R.string.employee_login_forgot_dev_code)

  var mode by remember { mutableStateOf(EmployeeLoginMode.Login) }
  // Employee apps always use the cloud default; no gateway config UI.
  val gatewayUrl = DEFAULT_GATEWAY_BASE_URL
  var email by remember { mutableStateOf("") }
  var password by remember { mutableStateOf("") }
  var inviteCode by remember { mutableStateOf("") }
  var displayName by remember { mutableStateOf("") }
  var resetCode by remember { mutableStateOf("") }
  var isSubmitting by remember { mutableStateOf(false) }
  var errorMessage by remember { mutableStateOf<String?>(null) }
  var infoMessage by remember { mutableStateOf<String?>(null) }

  val gatewayValid = EmployeeLoginForm.isValidGateway(gatewayUrl)
  val canSubmit =
    !isSubmitting &&
      EmployeeLoginForm.canSubmit(
        mode = mode,
        email = email,
        password = password,
        inviteCode = inviteCode,
        resetCode = resetCode,
        gatewayValid = gatewayValid,
      )

  fun clearFeedback() {
    errorMessage = null
    infoMessage = null
  }

  fun submit() {
    if (!canSubmit) return
    val submittedMode = mode
    isSubmitting = true
    clearFeedback()
    scope.launch {
      val trimmedEmail = email.trim()
      val outcome =
        when (submittedMode) {
          EmployeeLoginMode.Login -> controller.login(gatewayUrl.trim(), trimmedEmail, password)
          EmployeeLoginMode.Forgot -> controller.forgotPassword(gatewayUrl.trim(), trimmedEmail)
          EmployeeLoginMode.Register ->
            controller.register(
              gatewayUrl.trim(),
              trimmedEmail,
              inviteCode.trim(),
              password,
              displayName.trim().ifBlank { null },
            )
          EmployeeLoginMode.Reset ->
            controller.resetPassword(gatewayUrl.trim(), trimmedEmail, password, resetCode.trim())
        }
      isSubmitting = false
      when (outcome) {
        is EmployeeAuthOutcome.LoggedIn -> {
          password = ""
          if (submittedMode == EmployeeLoginMode.Register) inviteCode = ""
          if (submittedMode == EmployeeLoginMode.Reset) resetCode = ""
          onLoggedIn(outcome.account)
        }
        is EmployeeAuthOutcome.Info -> {
          infoMessage =
            EmployeeLoginForm.forgotNotice(outcome.pendingResetCode, forgotSentMessage, forgotDevTemplate)
          mode = EmployeeLoginForm.modeAfterForgotAttempt(submittedMode)
        }
        is EmployeeAuthOutcome.Error -> {
          errorMessage = outcome.message
          mode = EmployeeLoginForm.modeAfterForgotAttempt(submittedMode)
        }
      }
    }
  }

  BoxWithConstraints(
    modifier =
      modifier
        .fillMaxSize()
        .background(EmployeeLoginPalette.background)
        .statusBarsPadding()
        .navigationBarsPadding()
        .imePadding(),
  ) {
    Column(
      modifier =
        Modifier
          .fillMaxWidth()
          .verticalScroll(rememberScrollState())
          .heightIn(min = maxHeight)
          .padding(horizontal = 24.dp, vertical = 20.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.Center,
    ) {
      Column(
        modifier = Modifier.widthIn(max = 400.dp).fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(18.dp),
      ) {
        BrandHeader(mode)
        ModeHeader(
          mode = mode,
          enabled = !isSubmitting,
          onSelect = { next ->
            mode = next
            clearFeedback()
          },
          onBack = {
            mode = EmployeeLoginMode.Login
            clearFeedback()
          },
        )
        FormFields(
          mode = mode,
          email = email,
          onEmail = { email = it },
          password = password,
          onPassword = { password = it },
          displayName = displayName,
          onDisplayName = { displayName = it },
          inviteCode = inviteCode,
          onInviteCode = { inviteCode = it },
          resetCode = resetCode,
          onResetCode = { resetCode = it },
          onSubmit = { submit() },
        )
        Feedback(errorMessage = errorMessage, infoMessage = infoMessage)
        PrimaryButton(
          title = primaryTitle(mode),
          enabled = canSubmit,
          busy = isSubmitting,
          onClick = { submit() },
        )
        FooterLinks(
          mode = mode,
          enabled = !isSubmitting,
          onForgot = { mode = EmployeeLoginMode.Forgot },
          onHaveCode = { mode = EmployeeLoginMode.Reset },
        )
      }
    }
  }
}

@Composable
private fun BrandHeader(mode: EmployeeLoginMode) {
  Column(
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(8.dp),
    modifier = Modifier.fillMaxWidth(),
  ) {
    Image(
      painter = painterResource(R.drawable.openbot_auth_logo),
      contentDescription = stringResource(R.string.employee_login_logo_content_description),
      contentScale = ContentScale.Fit,
      modifier = Modifier.fillMaxWidth().aspectRatio(AUTH_LOGO_ASPECT),
    )
    Text(
      text = stringResource(R.string.employee_login_slogan),
      color = EmployeeLoginPalette.ink,
      fontSize = 18.sp,
      fontWeight = FontWeight.SemiBold,
      textAlign = TextAlign.Center,
      modifier = Modifier.semantics { heading() },
    )
    Text(
      text = subtitle(mode),
      color = EmployeeLoginPalette.muted,
      fontSize = 14.sp,
      textAlign = TextAlign.Center,
    )
  }
}

@Composable
private fun subtitle(mode: EmployeeLoginMode): String =
  stringResource(
    when (mode) {
      EmployeeLoginMode.Login -> R.string.employee_login_subtitle_login
      EmployeeLoginMode.Register -> R.string.employee_login_subtitle_register
      EmployeeLoginMode.Forgot -> R.string.employee_login_subtitle_forgot
      EmployeeLoginMode.Reset -> R.string.employee_login_subtitle_reset
    },
  )

@Composable
private fun primaryTitle(mode: EmployeeLoginMode): String =
  stringResource(
    when (mode) {
      EmployeeLoginMode.Login -> R.string.employee_login_mode_login
      EmployeeLoginMode.Register -> R.string.employee_login_action_register
      EmployeeLoginMode.Forgot -> R.string.employee_login_action_forgot
      EmployeeLoginMode.Reset -> R.string.employee_login_action_reset
    },
  )

@Composable
private fun ModeHeader(
  mode: EmployeeLoginMode,
  enabled: Boolean,
  onSelect: (EmployeeLoginMode) -> Unit,
  onBack: () -> Unit,
) {
  if (EmployeeLoginForm.showsSegmentedControl(mode)) {
    SegmentedAuthMode(
      mode = mode,
      enabled = enabled,
      onSelect = onSelect,
    )
  } else {
    val title =
      stringResource(
        if (mode == EmployeeLoginMode.Forgot) {
          R.string.employee_login_mode_forgot
        } else {
          R.string.employee_login_mode_reset
        },
      )
    Row(
      modifier =
        Modifier
          .heightIn(min = 48.dp)
          .clip(RoundedCornerShape(8.dp))
          .clickable(enabled = enabled, role = Role.Button, onClick = onBack)
          .padding(horizontal = 4.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      Icon(
        imageVector = Icons.AutoMirrored.Filled.ArrowBack,
        contentDescription = null,
        tint = EmployeeLoginPalette.ink,
        modifier = Modifier.size(16.dp),
      )
      Text(
        text = title,
        color = EmployeeLoginPalette.ink,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
      )
    }
  }
}

@Composable
private fun SegmentedAuthMode(
  mode: EmployeeLoginMode,
  enabled: Boolean,
  onSelect: (EmployeeLoginMode) -> Unit,
) {
  Row(
    modifier =
      Modifier
        .width(240.dp)
        .height(40.dp)
        .clip(RoundedCornerShape(20.dp))
        .background(EmployeeLoginPalette.segmentTrack)
        .padding(3.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    AuthSegment(
      label = stringResource(R.string.employee_login_mode_login),
      selected = mode == EmployeeLoginMode.Login,
      enabled = enabled,
      onClick = { onSelect(EmployeeLoginMode.Login) },
      modifier = Modifier.weight(1f),
    )
    AuthSegment(
      label = stringResource(R.string.employee_login_mode_register),
      selected = mode == EmployeeLoginMode.Register,
      enabled = enabled,
      onClick = { onSelect(EmployeeLoginMode.Register) },
      modifier = Modifier.weight(1f),
    )
  }
}

@Composable
private fun AuthSegment(
  label: String,
  selected: Boolean,
  enabled: Boolean,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
) {
  val shape = RoundedCornerShape(16.dp)
  Box(
    modifier =
      modifier
        .fillMaxHeight()
        .clip(shape)
        .background(if (selected) EmployeeLoginPalette.segmentSelected else Color.Transparent)
        .clickable(enabled = enabled, role = Role.Tab, onClick = onClick)
        .semantics { this.selected = selected }
        .padding(horizontal = 12.dp),
    contentAlignment = Alignment.Center,
  ) {
    Text(
      text = label,
      color = if (selected) EmployeeLoginPalette.onSegmentSelected else EmployeeLoginPalette.muted,
      fontSize = 14.sp,
      fontWeight = FontWeight.Medium,
    )
  }
}

@Composable
private fun FormFields(
  mode: EmployeeLoginMode,
  email: String,
  onEmail: (String) -> Unit,
  password: String,
  onPassword: (String) -> Unit,
  displayName: String,
  onDisplayName: (String) -> Unit,
  inviteCode: String,
  onInviteCode: (String) -> Unit,
  resetCode: String,
  onResetCode: (String) -> Unit,
  onSubmit: () -> Unit,
) {
  Column(
    modifier = Modifier.fillMaxWidth(),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    if (EmployeeLoginForm.showsDisplayName(mode)) {
      AuthField(
        label = stringResource(R.string.employee_login_display_name_label),
        value = displayName,
        onValueChange = onDisplayName,
        placeholder = stringResource(R.string.employee_login_display_name_placeholder),
        onSubmit = onSubmit,
      )
    }
    AuthField(
      label = stringResource(R.string.employee_login_email_label),
      value = email,
      onValueChange = onEmail,
      placeholder = stringResource(R.string.employee_login_email_placeholder),
      keyboardType = KeyboardType.Email,
      onSubmit = onSubmit,
    )
    if (EmployeeLoginForm.showsPassword(mode)) {
      AuthField(
        label =
          stringResource(
            if (EmployeeLoginForm.passwordIsNew(mode)) {
              R.string.employee_login_new_password_label
            } else {
              R.string.employee_login_password_label
            },
          ),
        value = password,
        onValueChange = onPassword,
        placeholder = stringResource(R.string.employee_login_password_placeholder),
        secure = true,
        keyboardType = KeyboardType.Password,
        onSubmit = onSubmit,
      )
    }
    if (EmployeeLoginForm.showsInviteCode(mode)) {
      AuthField(
        label = stringResource(R.string.employee_login_invite_label),
        value = inviteCode,
        onValueChange = onInviteCode,
        placeholder = stringResource(R.string.employee_login_invite_placeholder),
        onSubmit = onSubmit,
      )
    }
    if (EmployeeLoginForm.showsResetCode(mode)) {
      AuthField(
        label = stringResource(R.string.employee_login_reset_code_label),
        value = resetCode,
        onValueChange = onResetCode,
        placeholder = stringResource(R.string.employee_login_reset_code_placeholder),
        onSubmit = onSubmit,
      )
    }
  }
}

@Composable
private fun AuthField(
  label: String,
  value: String,
  onValueChange: (String) -> Unit,
  placeholder: String,
  secure: Boolean = false,
  keyboardType: KeyboardType = KeyboardType.Text,
  isError: Boolean = false,
  onSubmit: () -> Unit,
) {
  val shape = RoundedCornerShape(12.dp)
  Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
    Text(
      text = label,
      color = EmployeeLoginPalette.muted,
      fontSize = 12.sp,
      fontWeight = FontWeight.Medium,
    )
    BasicTextField(
      value = value,
      onValueChange = onValueChange,
      singleLine = true,
      textStyle = TextStyle(color = EmployeeLoginPalette.ink, fontSize = 14.sp),
      cursorBrush = SolidColor(EmployeeLoginPalette.accent),
      visualTransformation = if (secure) PasswordVisualTransformation() else VisualTransformation.None,
      keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = ImeAction.Done),
      keyboardActions = KeyboardActions(onDone = { onSubmit() }),
      modifier =
        Modifier
          .fillMaxWidth()
          .heightIn(min = 48.dp)
          .clip(shape)
          .background(EmployeeLoginPalette.fieldFill)
          .border(
            width = 1.dp,
            color = if (isError) EmployeeLoginPalette.error else EmployeeLoginPalette.fieldStroke,
            shape = shape,
          ).padding(horizontal = 12.dp, vertical = 10.dp)
          .semantics { contentDescription = label },
      decorationBox = { inner ->
        Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterStart) {
          if (value.isEmpty()) {
            Text(text = placeholder, color = EmployeeLoginPalette.muted.copy(alpha = 0.72f), fontSize = 14.sp)
          }
          inner()
        }
      },
    )
  }
}

@Composable
private fun Feedback(
  errorMessage: String?,
  infoMessage: String?,
) {
  when {
    !errorMessage.isNullOrEmpty() ->
      Text(
        text = errorMessage,
        color = EmployeeLoginPalette.error,
        fontSize = 12.sp,
        modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Assertive },
      )
    !infoMessage.isNullOrEmpty() ->
      Text(
        text = infoMessage,
        color = EmployeeLoginPalette.muted,
        fontSize = 12.sp,
        modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
      )
  }
}

@Composable
private fun PrimaryButton(
  title: String,
  enabled: Boolean,
  busy: Boolean,
  onClick: () -> Unit,
) {
  val shape = RoundedCornerShape(14.dp)
  Row(
    modifier =
      Modifier
        .fillMaxWidth()
        .heightIn(min = 48.dp)
        .clip(shape)
        .background(if (enabled) EmployeeLoginPalette.accent else EmployeeLoginPalette.accentDisabled)
        .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
        .padding(vertical = 12.dp),
    horizontalArrangement = Arrangement.Center,
    verticalAlignment = Alignment.CenterVertically,
  ) {
    if (busy) {
      CircularProgressIndicator(
        color = Color.White,
        strokeWidth = 2.dp,
        modifier = Modifier.padding(end = 8.dp).size(16.dp),
      )
    }
    Text(
      text = title,
      color = Color.White.copy(alpha = if (enabled) 1f else 0.85f),
      fontSize = 14.sp,
      fontWeight = FontWeight.SemiBold,
    )
  }
}

@Composable
private fun FooterLinks(
  mode: EmployeeLoginMode,
  enabled: Boolean,
  onForgot: () -> Unit,
  onHaveCode: () -> Unit,
) {
  Row(
    modifier = Modifier.fillMaxWidth().padding(top = 2.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    if (EmployeeLoginForm.showsForgotLink(mode)) {
      FooterLink(
        label = stringResource(R.string.employee_login_forgot_link),
        color = EmployeeLoginPalette.accent,
        enabled = enabled,
        onClick = onForgot,
      )
    }
    if (EmployeeLoginForm.showsHaveCodeLink(mode)) {
      FooterLink(
        label = stringResource(R.string.employee_login_have_code),
        color = EmployeeLoginPalette.accent,
        enabled = enabled,
        onClick = onHaveCode,
      )
    }
  }
}

@Composable
private fun FooterLink(
  label: String,
  color: Color,
  enabled: Boolean,
  onClick: () -> Unit,
) {
  Box(
    modifier =
      Modifier
        .heightIn(min = 44.dp)
        .clip(RoundedCornerShape(8.dp))
        .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
        .padding(horizontal = 2.dp),
    contentAlignment = Alignment.Center,
  ) {
    Text(
      text = label,
      color = color,
      fontSize = 12.sp,
      fontWeight = FontWeight.Medium,
    )
  }
}
