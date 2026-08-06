import { describe, expect, mock, test } from "bun:test";
import type { RefObject } from "react";
import { renderToString } from "react-dom/server";
import type { AppUpdateState } from "../../shared/electrobunRpc";
import type {
	MessageComposerHandle,
	MessageComposerProps,
} from "../components/MessageComposer";
import { CallProvider } from "../contexts/CallContext";
import { uiActions } from "../state/uiStore";
import type {
	MattermostChannel,
	MattermostTeam,
	MattermostUser,
} from "../types";
import type { CallManager } from "../webrtc/CallManager";

const composerProps: MessageComposerProps[] = [];

mock.module("./rpc", () => ({
	electrobun: {},
}));

mock.module("../storage", () => ({
	loadDismissedAppUpdateBannerKey: () => null,
	saveDismissedAppUpdateBannerKey: () => {},
}));

mock.module("../components/MessageComposer", () => ({
	MessageComposer: (props: MessageComposerProps) => {
		composerProps.push(props);
		return <div />;
	},
}));

const { ChatShell } = await import("./ChatShell");

const currentUser: MattermostUser = { id: "user-1", username: "sarah" };
const selectedTeam: MattermostTeam = {
	display_name: "Team",
	id: "team-1",
	name: "team",
};
const selectedChannel: MattermostChannel = {
	display_name: "Town Square",
	id: "channel-1",
	name: "town-square",
	team_id: selectedTeam.id,
	type: "O",
};
const appUpdate: AppUpdateState = {
	status: "idle",
	updateAvailable: false,
	updateReady: false,
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

function renderChatShell(selectedChannelId: string | null) {
	composerProps.length = 0;
	uiActions.setStatus("loading");
	renderToString(
		<CallProvider callManager={callManager}>
			<ChatShell
				api={null}
				appUpdate={appUpdate}
				channelEmojis={{}}
				channelMembers={[]}
				channelOrder={{}}
				channels={selectedChannelId ? [selectedChannel] : []}
				collapsedSections={{
					archived: false,
					channels: false,
					dms: false,
					favorites: false,
				}}
				composerHeight={140}
				composerRef={
					{ current: null } as RefObject<MessageComposerHandle | null>
				}
				currentUser={currentUser}
				favoriteChannelSet={new Set()}
				maxComposerHeight={320}
				maxSidebarWidth={480}
				minComposerHeight={80}
				minSidebarWidth={220}
				posts={[]}
				resolveImageSrc={async (src) => src}
				sections={{
					archived: [],
					channels: selectedChannelId ? [selectedChannel] : [],
					dms: [],
					favorites: [],
				}}
				selectedChannel={selectedChannelId ? selectedChannel : undefined}
				selectedChannelId={selectedChannelId}
				selectedTeam={selectedTeam}
				selectedTeamId={selectedTeam.id}
				settings={{
					fontFamily: "system",
					fontSize: 14,
					notificationPreference: "all",
					notificationSounds: true,
					ownMessageIndicatorColor: "#46a758",
					showOwnMessageIndicators: true,
					showProfilePictures: true,
					theme: "default",
					useNewComposer: false,
					devLoopback: false,
				}}
				sidebarWidth={280}
				teams={[selectedTeam]}
				userColors={{}}
				userImages={{}}
				userStatuses={{}}
				users={{ [currentUser.id]: currentUser }}
				onActivateChatTab={() => {}}
				onAddUserToSelectedChannel={async () => {}}
				onApplyAppUpdate={() => {}}
				onArchiveChannel={() => {}}
				onCancelEdit={() => {}}
				onCancelReply={() => {}}
				onCreateChannel={async () => {}}
				onCreateDm={async () => {}}
				onEditMessage={async () => {}}
				onLoadMoreMessages={async () => {}}
				onMoveChannel={() => {}}
				onOpenAttachment={async () => {}}
				onOpenSettings={() => {}}
				onSelectChannel={async () => {}}
				onSelectPost={async () => {}}
				onSelectTeam={async () => {}}
				onSendMessage={async () => {}}
				onSendPoll={async () => {}}
				onSendTyping={async () => {}}
				onSetChannelEmoji={() => {}}
				onSetComposerHeight={() => {}}
				onSetSidebarWidth={() => {}}
				onSetUserColor={() => {}}
				onShowChannelContextMenu={() => {}}
				onShowMessageContextMenu={() => {}}
				onSignOut={() => {}}
				onStartReply={() => {}}
				onToggleChannelSection={() => {}}
				onToggleFavoriteChannel={() => {}}
				onToggleReaction={async () => {}}
				onUnarchiveChannel={() => {}}
				onVotePoll={async () => {}}
			/>
		</CallProvider>,
	);
}

describe("ChatShell composer disabled state", () => {
	test("keeps the composer enabled during channel-history loading when a channel is selected", () => {
		renderChatShell(selectedChannel.id);

		expect(composerProps).toHaveLength(1);
		expect(composerProps[0].disabled).toBe(false);
	});

	test("disables the composer when no channel is selected", () => {
		renderChatShell(null);

		expect(composerProps).toHaveLength(1);
		expect(composerProps[0].disabled).toBe(true);
	});
});
