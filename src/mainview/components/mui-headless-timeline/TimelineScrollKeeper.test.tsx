import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToString } from "react-dom/server";
import { chatDataActions } from "../../state/chatDataStore";
import type {
	AppSettings,
	MattermostChannel,
	MattermostUser,
} from "../../types";
import { MuiMessageTimeline } from "./MuiMessageTimeline";
import {
	settleElapsed,
	shouldRePin,
	TIMELINE_SETTLE_MAX_MS,
	TIMELINE_SETTLE_STABLE_MS,
	TimelineScrollKeeper,
} from "./TimelineScrollKeeper";

const channel: MattermostChannel = {
	display_name: "Town Square",
	id: "channel-1",
	name: "town-square",
	team_id: "team-1",
	type: "O",
};
const currentUser: MattermostUser = { id: "user-1", username: "sarah" };
const otherUser: MattermostUser = { id: "user-2", username: "alex" };
const baseTime = new Date("2026-01-01T12:00:00Z").getTime();
const users: Record<string, MattermostUser> = {
	[currentUser.id]: currentUser,
	[otherUser.id]: otherUser,
};
const testSettings: AppSettings = {
	fontFamily: "system",
	fontSize: 14,
	theme: "default",
	showOwnMessageIndicators: true,
	ownMessageIndicatorColor: "#00aa00",
	notificationSounds: true,
	notificationPreference: "all",
	showProfilePictures: true,
	useNewComposer: false,
	devLoopback: false,
};

beforeEach(() => {
	chatDataActions.resetForSignOut();
	chatDataActions.setCurrentUser(currentUser);
	chatDataActions.setUsers(users);
	chatDataActions.setSettings(testSettings);
	chatDataActions.setUserColors({});
	chatDataActions.setUserImages({});
	chatDataActions.setUserStatuses({});
	chatDataActions.setResolveImageSrc(async (src) => src);
});

describe("TimelineScrollKeeper pin decisions", () => {
	test("always re-pins during the post-open settle window", () => {
		expect(
			shouldRePin({
				isAtBottom: false,
				lastHeight: 5000,
				settle: {
					channelId: "channel-1",
					lastChangeAt: 0,
					startedAt: 0,
				},
				wasAtBottom: false,
			}),
		).toBe(true);
	});

	test("re-pins when the viewport was at the bottom at its last scroll", () => {
		expect(
			shouldRePin({
				isAtBottom: false,
				lastHeight: 5000,
				settle: null,
				wasAtBottom: true,
			}),
		).toBe(true);
	});

	test("does not re-pin when the user had scrolled away from the bottom", () => {
		expect(
			shouldRePin({
				isAtBottom: false,
				lastHeight: 5000,
				settle: null,
				wasAtBottom: false,
			}),
		).toBe(false);
	});

	test("falls back to the context isAtBottom before any scroll is observed", () => {
		expect(
			shouldRePin({
				isAtBottom: true,
				lastHeight: 5000,
				settle: null,
				wasAtBottom: undefined,
			}),
		).toBe(true);
		expect(
			shouldRePin({
				isAtBottom: false,
				lastHeight: 5000,
				settle: null,
				wasAtBottom: undefined,
			}),
		).toBe(false);
	});

	test("falls back to the context isAtBottom on the first observation", () => {
		expect(
			shouldRePin({
				isAtBottom: true,
				lastHeight: undefined,
				settle: null,
				wasAtBottom: false,
			}),
		).toBe(true);
		expect(
			shouldRePin({
				isAtBottom: false,
				lastHeight: undefined,
				settle: null,
				wasAtBottom: true,
			}),
		).toBe(false);
	});
});

describe("TimelineScrollKeeper settle window", () => {
	test("ends after the content height is stable for the stable window", () => {
		const settle = { channelId: "channel-1", lastChangeAt: 1000, startedAt: 0 };
		expect(
			settleElapsed(settle, 1000 + TIMELINE_SETTLE_STABLE_MS - 1).stable,
		).toBe(false);
		expect(settleElapsed(settle, 1000 + TIMELINE_SETTLE_STABLE_MS).stable).toBe(
			true,
		);
	});

	test("ends at the bounded maximum even if height keeps changing", () => {
		const settle = {
			channelId: "channel-1",
			lastChangeAt: TIMELINE_SETTLE_MAX_MS,
			startedAt: 0,
		};
		expect(settleElapsed(settle, TIMELINE_SETTLE_MAX_MS + 1).timedOut).toBe(
			true,
		);
	});
});

describe("TimelineScrollKeeper wiring", () => {
	test("timeline renders the keeper through the MessageList overlay slot", () => {
		const source = readFileSync(
			"src/mainview/components/mui-headless-timeline/MuiMessageTimeline.tsx",
			"utf8",
		);
		expect(source).toContain("TimelineScrollKeeper");
		expect(source).toMatch(/overlay=\{/);
	});

	test("keeper renders inert under server render (marker only, no DOM measurement)", () => {
		const html = renderToString(
			<Tooltip.Provider>
				<MuiMessageTimeline
					channel={channel}
					channelId={channel.id}
					loading={false}
					loadingHistory={false}
					onOpenAttachment={async () => {}}
					onReply={() => {}}
					onSetUserColor={() => {}}
					onShowMessageContextMenu={() => {}}
					onStartDm={() => {}}
					onToggleReaction={async () => {}}
					onVotePoll={async () => {}}
					posts={[
						{
							channel_id: channel.id,
							create_at: baseTime,
							delete_at: 0,
							id: "post-1",
							message: "hello",
							update_at: baseTime,
							user_id: otherUser.id,
						},
					]}
					typingUsers={[]}
				/>
			</Tooltip.Provider>,
		);
		expect(html).toContain("mui-timeline-scroll-keeper");
	});

	test("component module exports the keeper", () => {
		expect(typeof TimelineScrollKeeper).toBe("function");
	});
});
