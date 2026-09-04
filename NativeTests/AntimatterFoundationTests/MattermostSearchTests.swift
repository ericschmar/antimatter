import AntimatterFoundation
import Foundation
import Testing

struct MattermostSearchTests {
    @Test
    func searchFiltersBecomeMattermostModifiers() {
        var filters = MattermostPostSearchFilters()
        filters.channel = "engineering"
        filters.sender = "ada"
        filters.after = Date(timeIntervalSince1970: 1_704_067_200) // 2024-01-01 UTC
        filters.before = Date(timeIntervalSince1970: 1_735_603_200) // 2024-12-31 UTC
        filters.hasFiles = true
        filters.fileExtension = ".pdf"
        filters.threadScope = .replies
        filters.pinnedOnly = true
        filters.savedOnly = true

        #expect(
            filters.applying(to: "roadmap") ==
                "roadmap in:engineering from:ada after:2024-01-01 before:2024-12-31 has:files ext:pdf is:reply is:pinned is:saved"
        )
    }

    @Test
    func filtersCanFormASearchWithoutText() {
        var filters = MattermostPostSearchFilters()
        filters.channel = "town-square"
        filters.threadScope = .roots

        #expect(filters.hasActiveFilters)
        #expect(filters.applying(to: "  ") == "in:town-square -is:reply")
    }
}
