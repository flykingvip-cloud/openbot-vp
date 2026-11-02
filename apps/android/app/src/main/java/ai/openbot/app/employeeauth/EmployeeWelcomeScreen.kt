package ai.openbot.app.employeeauth

import ai.openbot.app.R
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * First-install welcome for the employee app. Shown once before the login card;
 * a local prefs flag suppresses it on later launches (and on upgrade for
 * already-used installs).
 */
@Composable
fun EmployeeWelcomeScreen(
  onContinue: () -> Unit,
  modifier: Modifier = Modifier,
) {
  Box(
    modifier =
      modifier
        .fillMaxSize()
        .background(WelcomePalette.background)
        .statusBarsPadding()
        .navigationBarsPadding(),
  ) {
    Column(
      modifier =
        Modifier
          .fillMaxSize()
          .verticalScroll(rememberScrollState())
          .padding(horizontal = 28.dp, vertical = 24.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.SpaceBetween,
    ) {
      Spacer(Modifier.height(12.dp))
      Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth(),
      ) {
        Image(
          painter = painterResource(R.drawable.openbot_auth_logo),
          contentDescription = stringResource(R.string.employee_login_logo_content_description),
          contentScale = ContentScale.Fit,
          modifier = Modifier.fillMaxWidth().aspectRatio(1536f / 1024f),
        )
        Text(
          text = stringResource(R.string.employee_welcome_title),
          color = WelcomePalette.ink,
          fontSize = 26.sp,
          fontWeight = FontWeight.SemiBold,
          textAlign = TextAlign.Center,
          modifier = Modifier.semantics { heading() },
        )
        Text(
          text = stringResource(R.string.employee_welcome_subtitle),
          color = WelcomePalette.muted,
          fontSize = 15.sp,
          textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(8.dp))
        WelcomePoint(text = stringResource(R.string.employee_welcome_point_1))
        WelcomePoint(text = stringResource(R.string.employee_welcome_point_2))
      }
      Column(
        modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth().padding(bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
      ) {
        val cta = stringResource(R.string.employee_welcome_cta)
        Box(
          modifier =
            Modifier
              .fillMaxWidth()
              .height(52.dp)
              .clip(RoundedCornerShape(14.dp))
              .background(WelcomePalette.accent)
              .semantics {
                role = Role.Button
                contentDescription = cta
              }
              .clickable(onClick = onContinue),
          contentAlignment = Alignment.Center,
        ) {
          Text(
            text = cta,
            color = Color.White,
            fontSize = 16.sp,
            fontWeight = FontWeight.SemiBold,
          )
        }
      }
    }
  }
}

@Composable
private fun WelcomePoint(text: String) {
  Row(
    horizontalArrangement = Arrangement.spacedBy(12.dp),
    verticalAlignment = Alignment.Top,
    modifier = Modifier.fillMaxWidth(),
  ) {
    Box(
      modifier =
        Modifier
          .padding(top = 6.dp)
          .size(8.dp)
          .clip(CircleShape)
          .background(WelcomePalette.accent),
    )
    Text(
      text = text,
      color = WelcomePalette.ink,
      fontSize = 15.sp,
      lineHeight = 22.sp,
      modifier = Modifier.weight(1f),
    )
  }
}

private object WelcomePalette {
  val background = Color(0xFFF6F5F2)
  val ink = Color(0xFF24211F)
  val muted = Color(0xFF736E66)
  val accent = Color(0xFF8C6629)
}
