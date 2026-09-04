import EmojiData
import XCTest

final class EmojiShortcodeTests: XCTestCase {
    func testMattermostReactionAliasesResolveThroughEmojiData() {
        XCTAssertEqual(EmojiData.emoji(fromShortName: "+1")?.character, "👍")
        XCTAssertEqual(EmojiData.emoji(fromShortName: "thumbsup")?.character, "👍")
    }
}
