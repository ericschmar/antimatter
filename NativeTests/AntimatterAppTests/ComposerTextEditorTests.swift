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
