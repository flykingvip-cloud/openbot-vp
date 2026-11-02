package ai.openbot.app.employeeauth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Guards the employee login / offline copy that `EmployeeLoginScreen` and
 * `EmployeeShellHost` read via `R.string.*`. Missing keys fail assembleDebug.
 * Chinese copy is pinned to Mac `PlatformAuthView`.
 */
class EmployeeLoginStringsTest {
  private val requiredKeys =
    listOf(
      "employee_login_title",
      "employee_login_slogan",
      "employee_login_subtitle_login",
      "employee_login_subtitle_register",
      "employee_login_subtitle_forgot",
      "employee_login_subtitle_reset",
      "employee_login_mode_login",
      "employee_login_mode_register",
      "employee_login_mode_forgot",
      "employee_login_mode_reset",
      "employee_login_action_register",
      "employee_login_action_forgot",
      "employee_login_action_reset",
      "employee_login_forgot_link",
      "employee_login_have_code",
      "employee_login_advanced",
      "employee_login_hide_gateway",
      "employee_login_forgot_sent",
      "employee_login_forgot_dev_code",
      "employee_login_gateway_label",
      "employee_login_gateway_placeholder",
      "employee_login_email_label",
      "employee_login_email_placeholder",
      "employee_login_password_label",
      "employee_login_password_placeholder",
      "employee_login_new_password_label",
      "employee_login_invite_label",
      "employee_login_invite_placeholder",
      "employee_login_display_name_label",
      "employee_login_display_name_placeholder",
      "employee_login_reset_code_label",
      "employee_login_reset_code_placeholder",
      "employee_login_logo_content_description",
      "employee_login_switch_account",
      "employee_shell_offline_title",
      "employee_shell_offline_body",
      "employee_shell_retry",
    )

  private val chineseCopy =
    mapOf(
      "employee_login_slogan" to "面向团队的 AI 工作台",
      "employee_login_subtitle_login" to "协作、沉淀知识、推进工作，在一个空间内完成。",
      "employee_login_subtitle_register" to "使用邀请码加入企业工作区。",
      "employee_login_subtitle_forgot" to "输入邮箱，获取密码重置验证码。",
      "employee_login_subtitle_reset" to "输入验证码与新密码完成重置。",
      "employee_login_mode_login" to "登录",
      "employee_login_mode_register" to "注册",
      "employee_login_mode_forgot" to "找回密码",
      "employee_login_mode_reset" to "重置密码",
      "employee_login_action_register" to "加入工作区",
      "employee_login_action_forgot" to "发送重置码",
      "employee_login_action_reset" to "更新密码",
      "employee_login_forgot_link" to "忘记密码？",
      "employee_login_have_code" to "我有验证码",
      "employee_login_advanced" to "高级",
      "employee_login_hide_gateway" to "收起网关",
      "employee_login_forgot_sent" to "重置邮件已发送，请查收验证码后完成重置。",
      "employee_login_forgot_dev_code" to "已生成重置码（开发环境）：%1\$s",
      "employee_login_email_label" to "邮箱",
      "employee_login_password_label" to "密码",
      "employee_login_new_password_label" to "新密码",
      "employee_login_gateway_label" to "网关",
      "employee_login_reset_code_label" to "验证码",
      "employee_login_reset_code_placeholder" to "邮件中的重置码",
      "employee_login_display_name_placeholder" to "你的名字",
      "employee_login_invite_placeholder" to "企业邀请码",
    )

  @Test
  fun valuesAndZhCnDefineEveryEmployeeShellString() {
    val english = loadValues(File("src/main/res/values/strings.xml"))
    val chinese = loadValues(File("src/main/res/values-zh-rCN/strings.xml"))
    for (key in requiredKeys) {
      assertTrue("missing $key in values/strings.xml", key in english)
      assertTrue("missing $key in values-zh-rCN/strings.xml", key in chinese)
    }
  }

  @Test
  fun defaultAndZhCnMatchPlatformAuthCopy() {
    val english = loadValues(File("src/main/res/values/strings.xml"))
    val chinese = loadValues(File("src/main/res/values-zh-rCN/strings.xml"))
    for ((key, expected) in chineseCopy) {
      assertEquals("values $key", expected, english[key])
      assertEquals("zh-rCN $key", expected, chinese[key])
    }
  }

  @Test
  fun loginScreenDoesNotOfferAccountSwitcher() {
    val source = File("src/main/java/ai/openbot/app/employeeauth/EmployeeLoginScreen.kt").readText()
    assertFalse(source.contains("employee_login_switch_account"))
    assertFalse(source.contains("switchAccount"))
    assertFalse(source.contains("accounts()"))
    assertFalse(source.contains("employee_login_advanced"))
    assertFalse(source.contains("employee_login_hide_gateway"))
    assertFalse(source.contains("employee_login_gateway_label"))
    assertTrue(source.contains("employee_login_forgot_link"))
    assertTrue(source.contains("openbot_auth_logo"))
    assertTrue(source.contains("DEFAULT_GATEWAY_BASE_URL"))
  }

  @Test
  fun appCompilesAgainstSdk37() {
    val gradle = File("build.gradle.kts").readText()
    assertTrue(
      "androidx AARs require compileSdk >= 37; keep targetSdk separate",
      Regex("""compileSdk\s*=\s*37\b""").containsMatchIn(gradle),
    )
  }

  private fun loadValues(file: File): Map<String, String> {
    assertTrue("expected ${file.path}", file.isFile)
    return Regex("""<string name="([^"]+)">([^<]*)</string>""")
      .findAll(file.readText())
      .associate { it.groupValues[1] to it.groupValues[2] }
  }
}
