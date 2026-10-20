package ai.openbot.app.employeeauth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** IA rules shared with Mac PlatformAuthView. No Compose runtime. */
class EmployeeLoginFormTest {
  @Test
  fun gatewayStartsHidden() {
    assertTrue(EmployeeLoginForm.gatewayHiddenByDefault)
  }

  @Test
  fun segmentedControlIsLoginAndRegisterOnly() {
    assertTrue(EmployeeLoginForm.showsSegmentedControl(EmployeeLoginMode.Login))
    assertTrue(EmployeeLoginForm.showsSegmentedControl(EmployeeLoginMode.Register))
    assertFalse(EmployeeLoginForm.showsSegmentedControl(EmployeeLoginMode.Forgot))
    assertFalse(EmployeeLoginForm.showsSegmentedControl(EmployeeLoginMode.Reset))
  }

  @Test
  fun forgotHidesPasswordAndResetShowsNewPasswordPlusCode() {
    assertFalse(EmployeeLoginForm.showsPassword(EmployeeLoginMode.Forgot))
    assertTrue(EmployeeLoginForm.showsPassword(EmployeeLoginMode.Login))
    assertTrue(EmployeeLoginForm.showsPassword(EmployeeLoginMode.Reset))
    assertTrue(EmployeeLoginForm.passwordIsNew(EmployeeLoginMode.Reset))
    assertFalse(EmployeeLoginForm.passwordIsNew(EmployeeLoginMode.Login))
    assertTrue(EmployeeLoginForm.showsResetCode(EmployeeLoginMode.Reset))
    assertFalse(EmployeeLoginForm.showsResetCode(EmployeeLoginMode.Forgot))
  }

  @Test
  fun registerShowsNameAndInvite() {
    assertTrue(EmployeeLoginForm.showsDisplayName(EmployeeLoginMode.Register))
    assertTrue(EmployeeLoginForm.showsInviteCode(EmployeeLoginMode.Register))
    assertFalse(EmployeeLoginForm.showsInviteCode(EmployeeLoginMode.Login))
  }

  @Test
  fun footerLinksMatchMode() {
    assertTrue(EmployeeLoginForm.showsForgotLink(EmployeeLoginMode.Login))
    assertFalse(EmployeeLoginForm.showsForgotLink(EmployeeLoginMode.Register))
    assertTrue(EmployeeLoginForm.showsHaveCodeLink(EmployeeLoginMode.Forgot))
    assertFalse(EmployeeLoginForm.showsHaveCodeLink(EmployeeLoginMode.Reset))
  }

  @Test
  fun loginRequiresEmailAndPassword() {
    assertFalse(can(EmployeeLoginMode.Login, email = "", password = "secret"))
    assertFalse(can(EmployeeLoginMode.Login, email = "a@b.c", password = ""))
    assertTrue(can(EmployeeLoginMode.Login, email = " a@b.c ", password = "secret"))
  }

  @Test
  fun forgotRequiresOnlyEmailThenAdvancesToReset() {
    assertTrue(can(EmployeeLoginMode.Forgot, email = "a@b.c", password = ""))
    assertFalse(can(EmployeeLoginMode.Forgot, email = "  ", password = "x"))
    assertEquals(
      EmployeeLoginMode.Reset,
      EmployeeLoginForm.modeAfterForgotAttempt(EmployeeLoginMode.Forgot),
    )
    assertEquals(
      EmployeeLoginMode.Login,
      EmployeeLoginForm.modeAfterForgotAttempt(EmployeeLoginMode.Login),
    )
  }

  @Test
  fun resetRequiresEmailPasswordAndCode() {
    assertFalse(can(EmployeeLoginMode.Reset, email = "a@b.c", password = "secret", resetCode = ""))
    assertFalse(can(EmployeeLoginMode.Reset, email = "a@b.c", password = "", resetCode = "ABC"))
    assertTrue(can(EmployeeLoginMode.Reset, email = "a@b.c", password = "secret", resetCode = " ABC "))
  }

  @Test
  fun registerRequiresInviteButNotDisplayName() {
    assertFalse(can(EmployeeLoginMode.Register, email = "a@b.c", password = "secret", invite = ""))
    assertTrue(can(EmployeeLoginMode.Register, email = "a@b.c", password = "secret", invite = "CODE"))
  }

  @Test
  fun invalidGatewayBlocksSubmit() {
    assertFalse(
      EmployeeLoginForm.canSubmit(
        mode = EmployeeLoginMode.Login,
        email = "a@b.c",
        password = "secret",
        inviteCode = "",
        resetCode = "",
        gatewayValid = false,
      ),
    )
    assertTrue(EmployeeLoginForm.isValidGateway("https://www.openbot.love"))
    assertFalse(EmployeeLoginForm.isValidGateway("not a url"))
    assertFalse(EmployeeLoginForm.isValidGateway(""))
  }

  @Test
  fun forgotNoticePrefersDevResetCode() {
    assertEquals(
      "重置邮件已发送，请查收验证码后完成重置。",
      EmployeeLoginForm.forgotNotice(null, "重置邮件已发送，请查收验证码后完成重置。", "已生成重置码（开发环境）：%s"),
    )
    assertEquals(
      "已生成重置码（开发环境）：RESET-1",
      EmployeeLoginForm.forgotNotice(" RESET-1 ", "sent", "已生成重置码（开发环境）：%s"),
    )
  }

  private fun can(
    mode: EmployeeLoginMode,
    email: String,
    password: String,
    invite: String = "",
    resetCode: String = "",
  ): Boolean =
    EmployeeLoginForm.canSubmit(
      mode = mode,
      email = email,
      password = password,
      inviteCode = invite,
      resetCode = resetCode,
      gatewayValid = true,
    )
}
