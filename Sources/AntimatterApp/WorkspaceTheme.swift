import SwiftUI

enum WorkspaceTheme {
    static let canvas = Color(red: 0.075, green: 0.086, blue: 0.102)
    static let sidebar = Color(red: 0.102, green: 0.118, blue: 0.137)
    static let surface = Color(red: 0.118, green: 0.137, blue: 0.157)
    static let raisedSurface = Color(red: 0.145, green: 0.165, blue: 0.188)
    static let divider = Color.white.opacity(0.09)
    static let primaryText = Color(red: 0.91, green: 0.93, blue: 0.95)
    static let secondaryText = Color(red: 0.55, green: 0.60, blue: 0.65)
    static let accent = Color(red: 0.24, green: 0.65, blue: 0.42)
    static let attention = Color(red: 0.83, green: 0.58, blue: 0.22)

    static let titleHeight: CGFloat = 32
    static let headerHeight: CGFloat = 54
    static let sidebarWidth: CGFloat = 248
    static let compactCornerRadius: CGFloat = 5
}
