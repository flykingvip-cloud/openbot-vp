import SwiftUI

/// Design tokens for the four-tab companion (对话 / 任务 / 知识 / 我的).
/// Mirrors Android `MobileUiTokens.kt` and HTML SoT CSS vars (`--blue`, `--line`, …).
///
/// Text styles use the Manrope faces Android already bundles. The files in
/// `Sources/Fonts` must stay byte-identical to `res/font` (see
/// `scripts/check-mobile-tokens.mjs`). Colors stay hand-written literals.
enum OpenBotMobileTokens {
    // MARK: - Layout

    static let pageGutter: CGFloat = 20
    static let pageVertical: CGFloat = 16
    static let tabBarCornerRadius: CGFloat = 24
    static let tabItemCornerRadius: CGFloat = 16
    static let tabBarMinItemHeight: CGFloat = 58

    // MARK: - Colors (light companion — SoT)

    static let backgroundTop = Color(hex: 0xFFFFFF)
    static let backgroundMid = Color(hex: 0xF7F8FA)
    static let backgroundBottom = Color(hex: 0xEFF1F5)

    static let surface = Color(hex: 0xF6F7FA)
    static let surfaceStrong = Color(hex: 0xECEEF3)
    static let border = Color(hex: 0xE5E7EC)
    static let borderStrong = Color(hex: 0xD6DAE2)

    static let text = Color(hex: 0x17181C)
    static let textSecondary = Color(hex: 0x5D6472)
    static let textTertiary = Color(hex: 0x99A0AE)

    /// SoT `--blue`
    static let accent = Color(hex: 0x2F6BFF)
    /// SoT `--blue-soft`
    static let accentSoft = Color(hex: 0xE8F0FF)

    static let success = Color(hex: 0x2F8C5A)
    static let successSoft = Color(hex: 0xEEF9F3)
    static let warning = Color(hex: 0xC8841A)
    static let warningSoft = Color(hex: 0xFFF8EC)
    static let danger = Color(hex: 0xD04B4B)
    static let dangerSoft = Color(hex: 0xFFF2F2)

    static let codeBg = Color(hex: 0x15171B)
    static let codeText = Color(hex: 0xE8EAEE)

    static let tabBarBackground = Color.white.opacity(0.97)

    static var backgroundGradient: LinearGradient {
        LinearGradient(
            colors: [self.backgroundTop, self.backgroundMid, self.backgroundBottom],
            startPoint: .top,
            endPoint: .bottom)
    }

    // MARK: - Type (point sizes match Android sp; face is Manrope)

    static func title1(_ weight: Font.Weight = .semibold) -> Font {
        self.manrope(size: 24, weight: weight)
    }

    static func title2(_ weight: Font.Weight = .semibold) -> Font {
        self.manrope(size: 20, weight: weight)
    }

    static func headline(_ weight: Font.Weight = .semibold) -> Font {
        self.manrope(size: 16, weight: weight)
    }

    static func body(_ weight: Font.Weight = .medium) -> Font {
        self.manrope(size: 15, weight: weight)
    }

    static func callout(_ weight: Font.Weight = .medium) -> Font {
        self.manrope(size: 14, weight: weight)
    }

    static func caption1(_ weight: Font.Weight = .medium) -> Font {
        self.manrope(size: 12, weight: weight)
    }

    static func caption2(_ weight: Font.Weight = .medium) -> Font {
        self.manrope(size: 11, weight: weight)
    }

    /// HTML `.module-title` ≈ 26/700 — used for 任务 / 知识 / 我的 headers.
    static func moduleTitle() -> Font {
        self.manrope(size: 26, weight: .bold)
    }

    /// PostScript names, not `.weight`, because the static Medium and SemiBold
    /// files do not share a clean family name (name ID 1 is "Manrope Medium").
    static func manrope(size: CGFloat, weight: Font.Weight) -> Font {
        Font.custom(self.manropePostScriptName(weight), size: size)
    }

    static func manropePostScriptName(_ weight: Font.Weight) -> String {
        if weight == .bold || weight == .heavy || weight == .black {
            return "Manrope-Bold"
        }
        if weight == .semibold {
            return "Manrope-SemiBold"
        }
        if weight == .medium {
            return "Manrope-Medium"
        }
        return "Manrope-Regular"
    }
}

extension Color {
    /// RGB hex without alpha (0xRRGGBB).
    init(hex: UInt32, opacity: Double = 1) {
        let r = Double((hex >> 16) & 0xFF) / 255
        let g = Double((hex >> 8) & 0xFF) / 255
        let b = Double(hex & 0xFF) / 255
        self.init(.sRGB, red: r, green: g, blue: b, opacity: opacity)
    }
}
