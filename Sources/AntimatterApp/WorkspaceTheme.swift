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
    static let headerHeight: CGFloat = 54
    static let sidebarWidth: CGFloat = 248
    static let compactCornerRadius: CGFloat = 5
}
