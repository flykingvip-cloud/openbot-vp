package ai.openbot.app.employeeauth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import javax.imageio.ImageIO

/**
 * Cold-start mark is the original artwork file, shown with [androidx.compose.ui.layout.ContentScale.Fit].
 * The indexed PNG already stores a transparent background. Dark pixels inside the mark stay;
 * they are not a plate, and the test does not require them to be absent.
 */
class EmployeeAuthLogoTest {
  @Test
  fun authLogoMatchesOriginalArtworkBytes() {
    val file = File("src/main/res/drawable-nodpi/openbot_auth_logo.png")
    assertTrue("missing ${file.path}", file.isFile)
    val digest = MessageDigest.getInstance("SHA-256").digest(file.readBytes())
    val hex = digest.joinToString("") { "%02x".format(it) }
    assertEquals(ORIGINAL_SHA256, hex)
  }

  @Test
  fun authLogoBackgroundIsTransparent() {
    val file = File("src/main/res/drawable-nodpi/openbot_auth_logo.png")
    val image = ImageIO.read(file)
    assertEquals(1536, image.width)
    assertEquals(1024, image.height)
    assertTrue("original artwork keeps an alpha channel", image.colorModel.hasAlpha())
    assertEquals(0, alpha(image, 0, 0))
    assertEquals(0, alpha(image, image.width - 1, 0))
    assertEquals(0, alpha(image, 0, image.height - 1))
    assertEquals(0, alpha(image, image.width - 1, image.height - 1))
  }

  @Test
  fun brandHeaderContainsTheMarkWithoutStretching() {
    val source = File("src/main/java/ai/openbot/app/employeeauth/EmployeeLoginScreen.kt").readText()
    assertTrue(source.contains("ContentScale.Fit"))
    assertTrue(source.contains("1536f / 1024f"))
    assertTrue(source.contains("openbot_auth_logo"))
    assertFalse(source.contains("ContentScale.Crop"))
    assertFalse(source.contains("ContentScale.FillBounds"))
  }

  private fun alpha(
    image: java.awt.image.BufferedImage,
    x: Int,
    y: Int,
  ): Int = (image.getRGB(x, y) ushr 24) and 0xff

  private companion object {
    const val ORIGINAL_SHA256 = "484aaadee912c1576972fd543b29b537f2ec2ecafa21419398d02ec9c5798806"
  }
}
