import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { RefObject } from "react";
import { renderToString } from "react-dom/server";
import type { AppUpdateState } from "../../shared/electrobunRpc";
import type {
	MessageComposerHandle,
	MessageComposerProps,
} from "../components/MessageComposer";
import { CallProvider } from "../contexts/CallContext";
import type { ChatWorkspaceState } from "../state/chatWorkspace";
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

function renderChatShell(
	selectedChannelId: string | null,
	chatWorkspace?: ChatWorkspaceState | null,
) {
	composerProps.length = 0;
	uiActions.setStatus("loading");
	return renderToString(
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
				chatViewStates={{}}
				chatWorkspace={chatWorkspace}
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
				onCloseActiveChatTab={() => {}}
				onCloseChatTab={() => {}}
				onAddUserToSelectedChannel={async () => {}}
				onApplyAppUpdate={() => {}}
				onArchiveChannel={() => {}}
				onCancelEdit={() => {}}
				onCancelReply={() => {}}
				onCancelChatEdit={() => {}}
				onCancelChatReply={() => {}}
				onCreateChannel={async () => {}}
				onCreateDm={async () => {}}
				onEditMessage={async () => {}}
				onLoadMoreMessages={async () => {}}
				onOpenChatPanel={() => {}}
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
				onSetChatComposerHeight={() => {}}
				onSetChatWorkspaceLayout={() => {}}
				onSetComposerHeight={() => {}}
				onSetDraftMarkdown={() => {}}
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

describe("ChatShell workspace layout", () => {
	test("renders the selected channel body when workspace has no renderable tabs", () => {
		const html = renderChatShell("channel-1", {
			version: 1,
			activeTabId: null,
			tabs: {},
			layout: null,
		});

		expect(html).toContain("chat-body");
	});

	test("lets the chat workspace own the main area so each panel controls its header order", () => {
		const css = readFileSync("src/mainview/index.css", "utf8");
		const mainPanel = css.match(/\.main-panel \{[^}]+\}/)?.[0] ?? "";
		const chatWorkspace =
			css.match(/\.chat-workspace-preview \{[^}]+\}/)?.[0] ?? "";

		expect(mainPanel).toContain(
			"grid-template-rows: auto auto minmax(0, 1fr);",
		);
		expect(chatWorkspace).toContain("grid-row: 1 / -1;");
		expect(chatWorkspace).toContain("min-height: 0;");
	});

	test("styles chat workspace tabs with channel sidebar tokens", () => {
		const css = readFileSync("src/mainview/index.css", "utf8");

		const dockview =
			css.match(/\.chat-workspace-dockview \{[^}]+\}/)?.[0] ?? "";
		const dockviewTheme =
			css.match(
				/\.chat-workspace-dockview \.chat-workspace-dockview-theme \{[^}]+\}/,
			)?.[0] ?? "";
		const dockviewTabsAndActions =
			css.match(
				/\.chat-workspace-dockview \.dv-tabs-and-actions-container \{[^}]+\}/,
			)?.[0] ?? "";
		const dockviewTabs =
			css.match(
				/\.chat-workspace-dockview \.dv-tabs-container \{[^}]+\}/,
			)?.[0] ?? "";
		const dockviewTab =
			css.match(/\.chat-workspace-dockview \.dv-tab \{[^}]+\}/)?.[0] ?? "";
		const activeDockviewTab =
			css.match(
				/\.chat-workspace-dockview \.dv-tab\.dv-active-tab \{[^}]+\}/,
			)?.[0] ?? "";
		const dockviewTabHover =
			css.match(/\.chat-workspace-dockview \.dv-tab:hover \{[^}]+\}/)?.[0] ??
			"";
		const dockviewTabIcon =
			css.match(
				/\.chat-workspace-dockview \.dv-tab \.dv-default-tab-action,\s*\.chat-workspace-dockview \.dv-tab \.dv-icon \{[^}]+\}/,
			)?.[0] ?? "";
		const dockviewTabIconVisible =
			css.match(
				/\.chat-workspace-dockview \.dv-tab:hover \.dv-default-tab-action,\s*\.chat-workspace-dockview \.dv-tab:focus-within \.dv-default-tab-action,\s*\.chat-workspace-dockview \.dv-tab:hover \.dv-icon,\s*\.chat-workspace-dockview \.dv-tab:focus-within \.dv-icon \{[^}]+\}/,
			)?.[0] ?? "";

		expect(dockview).toContain("height: 100%;");
		expect(dockviewTheme).toContain(
			"--dv-tabs-and-actions-container-background-color: var(--app-bg);",
		);
		expect(dockviewTheme).toContain(
			"--dv-group-view-background-color: var(--app-bg);",
		);
		expect(dockviewTheme).toContain(
			"--dv-activegroup-visiblepanel-tab-background-color: transparent;",
		);
		expect(dockviewTheme).toContain(
			"--dv-activegroup-hiddenpanel-tab-background-color: transparent;",
		);
		expect(dockviewTheme).toContain(
			"--dv-activegroup-visiblepanel-tab-color: var(--text-primary);",
		);
		expect(dockviewTheme).toContain(
			"--dv-activegroup-hiddenpanel-tab-color: var(--text-secondary);",
		);
		expect(dockviewTabsAndActions).toContain("background: var(--app-bg);");
		expect(dockviewTabsAndActions).toContain(
			"border-bottom: 1px solid var(--border-subtle);",
		);
		expect(dockviewTabs).toContain("background: var(--app-bg);");
		expect(dockviewTabs).toContain("padding: 0 6px;");
		expect(dockviewTab).toContain("border-radius: 0;");
		expect(dockviewTab).toContain(
			"border-right: 1px solid var(--border-subtle);",
		);
		expect(dockviewTab).toContain("color: var(--text-secondary);");
		expect(dockviewTab).toContain("padding: 6px 10px;");
		expect(activeDockviewTab).toContain("background: transparent;");
		expect(activeDockviewTab).toContain("color: var(--text-primary);");
		expect(dockviewTabHover).toContain("background: var(--panel-hover);");
		expect(dockviewTabIcon).toContain("opacity: 0;");
		expect(dockviewTabIcon).toContain("visibility: hidden;");
		expect(dockviewTabIconVisible).toContain("opacity: 1;");
		expect(dockviewTabIconVisible).toContain("visibility: visible;");
	});
});

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
