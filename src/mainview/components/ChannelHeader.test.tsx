import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { CallProvider } from "../contexts/CallContext";
import type { AppSettings, MattermostUser } from "../types";
import type { CallManager } from "../webrtc/CallManager";
import { ChannelHeader } from "./ChannelHeader";

const settings: AppSettings = {
	fontFamily: "system-ui",
	fontSize: 14,
	theme: "warm",
	showOwnMessageIndicators: false,
	ownMessageIndicatorColor: "#0f0",
	notificationSounds: false,
	notificationPreference: "all",
	showProfilePictures: false,
	useNewComposer: false,
	devLoopback: false,
};

const callManager = {
	getState: () => "idle",
	getSession: () => null,
	getLocalStream: () => null,
	getRemoteStream: () => null,
	on: () => {},
	initiateCall: async () => {},
	acceptCall: async () => {},
	declineCall: async () => {},
	hangup: async () => {},
	setAudioMuted: () => {},
	setVideoEnabled: () => {},
	switchMicrophone: async () => {},
	switchCamera: async () => {},
} as unknown as CallManager;

function renderHeader(
	channelId: string,
	otherUser: MattermostUser | undefined,
) {
	const currentUserId = "user-self";
	const users: Record<string, MattermostUser> = otherUser
		? { [otherUser.id]: otherUser }
		: {};
	return renderToString(
		<CallProvider callManager={callManager}>
			<ChannelHeader
				channel={{
					id: channelId,
					team_id: "team-1",
					name: `${currentUserId}__${otherUser?.id ?? "user-other"}`,
					display_name: "",
					type: "D",
				}}
				channelMembers={[]}
				currentUserId={currentUserId}
				settings={settings}
				userImages={{}}
				userStatuses={{}}
				users={users}
				onOpenUserPicker={() => {}}
			/>
		</CallProvider>,
	);
}

describe("ChannelHeader direct message title", () => {
	test("renders the other user's name instead of their id", () => {
		const otherUser: MattermostUser = {
			id: "user-other",
			username: "acquaintance",
			first_name: "Acacia",
			last_name: "Quaint",
		};
		const markup = renderHeader("dm-1", otherUser);

		expect(markup).toContain("Acacia Quaint");
		expect(markup).not.toContain("user-other");
	});

	test("falls back to the other user id when the user is unknown", () => {
		const markup = renderHeader("dm-2", undefined);

		expect(markup).toContain("user-other");
	});
});
