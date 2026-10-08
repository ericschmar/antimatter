import AppKit
import SwiftUI
import XCTest

@testable import AntimatterApp

@MainActor
final class ComposerTextEditorTests: XCTestCase {
    func testCoordinatorWritesToUpdatedBinding() {
        let draft = TextBox("")
        let edit = TextBox("original")
        let coordinator = ComposerTextEditor.Coordinator(text: binding(for: draft))
        coordinator.text = binding(for: edit)

        let textView = NSTextView()
        textView.string = "edited"
        coordinator.textDidChange(Notification(name: NSText.didChangeNotification, object: textView))

        XCTAssertEqual(draft.value, "")
        XCTAssertEqual(edit.value, "edited")
    }

    func testFocusRequestFocusesEditorOnlyOnce() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 100, height: 100),
            styleMask: [.titled],
            backing: .buffered,
            defer: false
        )
        let container = NSView(frame: window.frame)
        let editor = ComposerNSTextView(frame: container.bounds)
        let otherResponder = NSTextField(frame: .zero)
        container.addSubview(editor)
        container.addSubview(otherResponder)
        window.contentView = container

        editor.focusRequestID = "channel-a"
        editor.focusIfRequested()
        XCTAssertTrue(window.firstResponder === editor)

        XCTAssertTrue(window.makeFirstResponder(otherResponder))
        editor.focusIfRequested()
        XCTAssertFalse(window.firstResponder === editor)
    }

    private func binding(for box: TextBox) -> Binding<String> {
        Binding(get: { box.value }, set: { box.value = $0 })
    }
}

private final class TextBox {
    var value: String

    init(_ value: String) {
        self.value = value
    }
}
