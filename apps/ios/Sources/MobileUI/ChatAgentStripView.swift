import SwiftUI

/// HTML SoT agent strip: icon above name. No "+" create button.
struct ChatAgentStripView: View {
    let model: AgentStripNavModel
    let onSelect: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 12) {
                ForEach(self.model.stripItems) { item in
                    Button {
                        self.onSelect(item.selectionKey)
                    } label: {
                        self.chip(item)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(item.rawTitle)
                    .accessibilityAddTraits(item.active ? .isSelected : [])
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)
            .padding(.bottom, 8)
        }
        .background(Color.white)
    }

    private func chip(_ item: AgentStripItem) -> some View {
        let iconBackground = self.iconBackground(item)
        return VStack(spacing: 5) {
            ZStack(alignment: .topTrailing) {
                RoundedRectangle(cornerRadius: item.module == .collaboration ? 16 : 14, style: .continuous)
                    .fill(iconBackground)
                    .overlay {
                        RoundedRectangle(cornerRadius: item.module == .collaboration ? 16 : 14, style: .continuous)
                            .strokeBorder(
                                item.active ? OpenBotMobileTokens.accent : Color.clear,
                                lineWidth: item.active ? 2 : 0)
                    }
                    .frame(width: 44, height: 44)
                    .overlay {
                        Image(systemName: self.symbol(item.iconKey))
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(item.active ? OpenBotMobileTokens.accent : Color(hex: 0x64748B))
                    }
                if item.id == builtinStewardNavID {
                    Text("📌")
                        .font(.system(size: 8))
                        .padding(.horizontal, 2)
                        .padding(.vertical, 1)
                        .background(Circle().fill(Color.white))
                        .overlay(Circle().strokeBorder(OpenBotMobileTokens.border, lineWidth: 1))
                } else if let badge = formatAgentStripBadge(item.count) {
                    Text(badge)
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(Circle().fill(OpenBotMobileTokens.danger))
                        .overlay(Circle().strokeBorder(Color.white, lineWidth: 2))
                }
            }
            Text(item.title)
                .font(OpenBotMobileTokens.caption2(.medium))
                .foregroundStyle(item.active ? OpenBotMobileTokens.accent : OpenBotMobileTokens.text)
                .lineLimit(1)
                .frame(width: 60)
        }
    }

    private func iconBackground(_ item: AgentStripItem) -> Color {
        switch item.module {
        case .collaboration:
            return Color(hex: 0xECFDF5)
        case .assistant:
            if item.iconKey == .brain {
                return Color(hex: 0xDBEAFE)
            }
            return Color(hex: 0xEEF2FF)
        }
    }

    private func symbol(_ key: AgentStripIconKey) -> String {
        switch key {
        case .brain: "brain.head.profile"
        case .sparkles: "sparkles"
        case .messageSquare: "bubble.left"
        case .zap: "bolt.fill"
        case .star: "star.fill"
        case .radio: "antenna.radiowaves.left.and.right"
        case .mic: "mic.fill"
        case .users: "person.2.fill"
        case .messagesSquare: "bubble.left.and.bubble.right.fill"
        case .calendar: "calendar"
        case .clipboardCheck: "checklist"
        }
    }
}
