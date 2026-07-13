import { describe, expect, test } from "bun:test";
import type { MattermostChannel } from "../types";
import type { ChannelNavigationContext } from "./channelNavigation";
import {
	findAdjacentMentionChannel,
	findAdjacentUnreadChannel,
	findAdjacentVisibleChannel,
	findSectionStartChannel,
	orderedSectionChannels,
} from "./channelNavigation";

describe("channel navigation", () => {
	test("uses manual order for favorites and channels", () => {
		const context = buildContext({
			channelOrder: { channels: ["b", "a"] },
			sections: { channels: [channel("a", "Alpha"), channel("b", "Beta")] },
		});

		expect(
			orderedSectionChannels(context, "channels").map((item) => item.id),
		).toEqual(["b", "a"]);
		expect(findSectionStartChannel(context, "channels")?.id).toBe("b");
	});

	test("orders DMs by most recent activity", () => {
		const context = buildContext({
			sections: {
				dms: [
					channel("old", "Old", "D", 100),
					channel("new", "New", "D", 300),
					channel("middle", "Middle", "D", 200),
				],
			},
		});

		expect(
			orderedSectionChannels(context, "dms").map((item) => item.id),
		).toEqual(["new", "middle", "old"]);
	});

	test("cycles through visible channels", () => {
		const context = buildContext({
			selectedChannelId: "b",
			channelOrder: { channels: ["a", "b"], dms: ["dm"] },
			sections: {
				channels: [channel("a", "Alpha"), channel("b", "Beta")],
				dms: [channel("dm", "Direct", "D")],
			},
		});

		expect(findAdjacentVisibleChannel(context, 1)?.id).toBe("dm");
		expect(findAdjacentVisibleChannel(context, -1)?.id).toBe("a");
	});

	test("prioritizes mention channels when cycling unread channels", () => {
		const context = buildContext({
			selectedChannelId: "a",
			channelOrder: { channels: ["a", "b", "c"] },
			notifications: {
				a: { unread: true, mention: false },
				b: { unread: true, mention: false },
				c: { unread: true, mention: true },
			},
			sections: {
				channels: [
					channel("a", "Alpha"),
					channel("b", "Beta"),
					channel("c", "Charlie"),
				],
			},
		});

		expect(findAdjacentUnreadChannel(context, 1)?.id).toBe("c");
	});

	test("cycles only mention channels for mention navigation", () => {
		const context = buildContext({
			selectedChannelId: "b",
			channelOrder: { channels: ["a", "b", "c"] },
			notifications: {
				a: { unread: true, mention: true },
				b: { unread: true, mention: false },
				c: { unread: true, mention: true },
			},
			sections: {
				channels: [
					channel("a", "Alpha"),
					channel("b", "Beta"),
					channel("c", "Charlie"),
				],
			},
		});

		expect(findAdjacentMentionChannel(context, 1)?.id).toBe("a");
		expect(findAdjacentMentionChannel(context, -1)?.id).toBe("c");
	});
});

function buildContext(
	overrides: Omit<
		Partial<ChannelNavigationContext>,
		"channelOrder" | "sections"
	> & {
		channelOrder?: Partial<ChannelNavigationContext["channelOrder"]>;
		sections?: Partial<ChannelNavigationContext["sections"]>;
	} = {},
): ChannelNavigationContext {
	return {
		channelOrder: {
			archived: [],
			channels: [],
			dms: [],
			favorites: [],
			...overrides.channelOrder,
		},
		currentUserId: "me",
		notifications: overrides.notifications ?? {},
		sections: {
			archived: [],
			channels: [],
			dms: [],
			favorites: [],
			...overrides.sections,
		},
		selectedChannelId: overrides.selectedChannelId ?? null,
		users: overrides.users ?? {},
	};
}

function channel(
	id: string,
	displayName: string,
	type: MattermostChannel["type"] = "O",
	lastPostAt = 0,
): MattermostChannel {
	return {
		display_name: displayName,
		id,
		last_post_at: lastPostAt,
		name: displayName.toLowerCase(),
		team_id: "team",
		type,
	};
}
