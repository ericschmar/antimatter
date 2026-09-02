import OSLog

/// Stable log categories for the native client.
///
/// Use these categories instead of creating ad-hoc loggers so Console filtering
/// and future diagnostic exports remain consistent.
public enum AppLogger {
    private static let subsystem = "com.antimatter.desktop"

    public static let application = Logger(subsystem: subsystem, category: "application")
    public static let networking = Logger(subsystem: subsystem, category: "networking")
    public static let persistence = Logger(subsystem: subsystem, category: "persistence")
    public static let workspace = Logger(subsystem: subsystem, category: "workspace")
}
