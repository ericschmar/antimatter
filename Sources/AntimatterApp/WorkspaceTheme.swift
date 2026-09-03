import SwiftUI

enum AccentColor: String, CaseIterable, Identifiable {
    case onyx
    case coral
    case oceanBlue
    case fern
    case amber
    case violet

    var id: Self { self }

    var name: String {
        switch self {
        case .onyx: "Onyx"
        case .coral: "Coral"
        case .oceanBlue: "Ocean Blue"
        case .fern: "Fern"
        case .amber: "Amber"
        case .violet: "Violet"
        }
    }

    var color: Color {
        switch self {
        case .onyx: Color(red: 0.13, green: 0.13, blue: 0.14)
        case .coral: Color(red: 0.90, green: 0.22, blue: 0.27)
        case .oceanBlue: Color(red: 0.0, green: 0.48, blue: 1.0)
        case .fern: Color(red: 0.20, green: 0.70, blue: 0.42)
        case .amber: Color(red: 0.98, green: 0.62, blue: 0.11)
        case .violet: Color(red: 0.60, green: 0.35, blue: 0.85)
        }
    }
}

@MainActor
final class AccentColorSettings: ObservableObject {
    private static let storageKey = "accentColor"

    @Published var selected: AccentColor {
        didSet {
            UserDefaults.standard.set(selected.rawValue, forKey: Self.storageKey)
        }
    }

    init(defaults: UserDefaults = .standard) {
        selected = AccentColor(rawValue: defaults.string(forKey: Self.storageKey) ?? "") ?? .oceanBlue
    }
}

@MainActor
final class UserColorSettings: ObservableObject {
    static let palette = [
        "#0d0305", "#3c3444", "#6e576e", "#917d9b", "#c5b7cb", "#f7f4e8",
        "#5f4f47", "#851246", "#d72048", "#7d322f", "#9d4c2f", "#c65e2d",
        "#f96a2d", "#ffa300", "#e29138", "#f7c233", "#f9ec41", "#11442c",
        "#287a33", "#52b139", "#8ae931", "#0e131e", "#203c62", "#2a69b0",
        "#00a1de", "#6bdad5", "#a52eb8", "#f7406e", "#fc83a2", "#f9cf9d",
        "#fba176", "#f66f67",
    ]

    private static let storageKey = "userNameColors"
    private let defaults: UserDefaults
    @Published private(set) var colors: [String: String]

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        colors = defaults.dictionary(forKey: Self.storageKey) as? [String: String] ?? [:]
    }

    func assignColors(to userIDs: some Sequence<String>) {
        var updatedColors = colors
        for userID in userIDs where updatedColors[userID] == nil {
            updatedColors[userID] = Self.automaticColor(for: userID)
        }
        save(updatedColors)
    }

    func setColor(_ hex: String, for userID: String) {
        var updatedColors = colors
        updatedColors[userID] = hex
        save(updatedColors)
    }

    func color(for userID: String) -> Color {
        Color(hex: colors[userID] ?? Self.automaticColor(for: userID))
    }

    func hexColor(for userID: String) -> String {
        colors[userID] ?? Self.automaticColor(for: userID)
    }

    private func save(_ updatedColors: [String: String]) {
        guard updatedColors != colors else { return }
        colors = updatedColors
        defaults.set(updatedColors, forKey: Self.storageKey)
    }

    private static func automaticColor(for userID: String) -> String {
        let hash = userID.utf8.reduce(UInt64(1_469_598_103_934_665_603)) { hash, byte in
            (hash ^ UInt64(byte)) &* 1_099_511_628_211
        }
        return palette[Int(hash % UInt64(palette.count))]
    }
}

extension Color {
    init(hex: String) {
        let value = UInt64(hex.dropFirst(), radix: 16) ?? 0
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}

enum WorkspaceTheme {
    static let canvas = Color(red: 0.075, green: 0.086, blue: 0.102)
    static let sidebar = Color(red: 0.102, green: 0.118, blue: 0.137)
    static let surface = Color(red: 0.118, green: 0.137, blue: 0.157)
    static let raisedSurface = Color(red: 0.145, green: 0.165, blue: 0.188)
    static let hoverSurface = Color.white.opacity(0.055)
    static let divider = Color.white.opacity(0.09)
    static let primaryText = Color(red: 0.91, green: 0.93, blue: 0.95)
    static let secondaryText = Color(red: 0.55, green: 0.60, blue: 0.65)
    static var accent: Color {
        AccentColor(rawValue: UserDefaults.standard.string(forKey: "accentColor") ?? "")?.color ?? AccentColor.oceanBlue.color
    }
    static let navigationAccent = Color(red: 0.28, green: 0.60, blue: 0.95)
    static let attention = Color(red: 0.83, green: 0.58, blue: 0.22)
    static let treeFolder = Color(red: 0, green: 0.47, blue: 1)

    static let titleHeight: CGFloat = 32
    static let titleBarContentHeight: CGFloat = 52
    static let titleBarControlInset: CGFloat = 72
    static let headerHeight: CGFloat = 54
    static let sidebarWidth: CGFloat = 248
    static let compactCornerRadius: CGFloat = 5
}
