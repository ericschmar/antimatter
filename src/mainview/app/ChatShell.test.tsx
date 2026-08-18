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
import { chatWorkspaceActions } from "../state/chatWorkspaceStore";
import { uiActions } from "../state/uiStore";
import type {
	MattermostChannel,
	MattermostPost,
	MattermostTeam,
	MattermostUser,
	WebSocketStatus,
} from "../types";
import type { CallManager } from "../webrtc/CallManager";

const composerProps: MessageComposerProps[] = [];
const chatWorkspaceProps: { posts: MattermostPost[] }[] = [];

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

mock.module("../components/ChatWorkspace", () => ({
	ChatWorkspace: (props: { posts: MattermostPost[] }) => {
		chatWorkspaceProps.push(props);
		return <div className="chat-workspace-preview" />;
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
const otherChannel: MattermostChannel = {
	display_name: "Off Topic",
	id: "channel-2",
	name: "off-topic",
	team_id: selectedTeam.id,
	type: "O",
};
const selectedChannelPost: MattermostPost = {
	channel_id: selectedChannel.id,
	create_at: 1,
	delete_at: 0,
	id: "post-1",
	message: "Selected channel post",
	update_at: 1,
	user_id: currentUser.id,
};
const otherChannelPost: MattermostPost = {
	channel_id: otherChannel.id,
	create_at: 2,
	delete_at: 0,
	id: "post-2",
	message: "Other channel post",
	update_at: 2,
	user_id: currentUser.id,
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
	appUpdateOverride?: AppUpdateState,
	options: {
		channels?: MattermostChannel[];
		error?: string | null;
		posts?: MattermostPost[];
		workspacePosts?: MattermostPost[];
		wsStatus?: WebSocketStatus;
	} = {},
) {
	composerProps.length = 0;
	chatWorkspaceProps.length = 0;
	chatWorkspaceActions.reset();
	if (chatWorkspace) chatWorkspaceActions.replaceWorkspace(chatWorkspace);
	uiActions.setStatus("loading");
	uiActions.setWsStatus(options.wsStatus ?? "idle");
	uiActions.setError(options.error ?? null);
	return renderToString(
		<CallProvider callManager={callManager}>
			<ChatShell
				api={null}
				appUpdate={appUpdateOverride ?? appUpdate}
				channelEmojis={{}}
				channelMembers={[]}
				channelOrder={{}}
				channels={
					options.channels ?? (selectedChannelId ? [selectedChannel] : [])
				}
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
				posts={options.posts ?? []}
				workspacePosts={options.workspacePosts ?? options.posts ?? []}
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
	test("renders update notifications as a persistent toast", () => {
		const html = renderChatShell("channel-1", null, {
			...appUpdate,
			status: "ready",
			updateAvailable: true,
			updateReady: true,
			version: "1.2.3",
		});

		expect(html).toContain("update-toast");
		expect(html).toContain("Antimatter 1.2.3 is ready to install.");
		expect(html).toContain("Dismiss update notification");
		expect(html).not.toContain("update-banner");
	});

	test("renders network outage notifications as a persistent toast", () => {
		const html = renderChatShell("channel-1", null, undefined, {
			wsStatus: "disconnected",
		});

		expect(html).toContain("update-toast network-outage-toast");
		expect(html).toContain("Network connection lost. Reconnecting…");
		expect(html).not.toContain("network-outage-banner");
	});

	test("renders RPC timeout errors as a toast instead of the inline error bar", () => {
		const html = renderChatShell("channel-1", null, undefined, {
			error: "RPC request timed out.",
		});

		expect(html).toContain("update-toast rpc-timeout-toast");
		expect(html).toContain("RPC request timed out.");
		expect(html).toContain("Dismiss error notification");
		expect(html).not.toContain("inline-error");
	});

	test("renders other errors in the inline error bar", () => {
		const html = renderChatShell("channel-1", null, undefined, {
			error: "Could not send message.",
		});

		expect(html).toContain("inline-error");
		expect(html).toContain("Could not send message.");
		expect(html).not.toContain("rpc-timeout-toast");
	});

	test("renders the selected channel body when workspace has no renderable tabs", () => {
		const html = renderChatShell("channel-1", {
			version: 1,
			activeTabId: null,
			tabs: {},
			layout: null,
		});

		expect(html).toContain("chat-body");
	});

	test("passes all loaded workspace channel posts to split chat panels", () => {
		renderChatShell(
			selectedChannel.id,
			{
				version: 1,
				activeTabId: "channel:channel-1",
				tabs: {
					"channel:channel-1": {
						channelId: selectedChannel.id,
						id: "channel:channel-1",
						teamId: selectedTeam.id,
						title: selectedChannel.display_name,
					},
					"channel:channel-2": {
						channelId: otherChannel.id,
						id: "channel:channel-2",
						teamId: selectedTeam.id,
						title: otherChannel.display_name,
					},
				},
				layout: null,
			},
			undefined,
			{
				channels: [selectedChannel, otherChannel],
				posts: [selectedChannelPost],
				workspacePosts: [selectedChannelPost, otherChannelPost],
			},
		);

		expect(chatWorkspaceProps).toHaveLength(1);
		expect(chatWorkspaceProps[0]?.posts.map((post) => post.id)).toEqual([
			selectedChannelPost.id,
			otherChannelPost.id,
		]);
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
		const dockviewContextMenu =
			css.match(/\.dv-context-menu \{[^}]+\}/)?.[0] ?? "";

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
			"--dv-context-menu-background-color: var(--panel-raised);",
		);
		expect(dockviewTheme).toContain(
			"--dv-context-menu-color: var(--text-primary);",
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
		expect(dockviewTab).toContain("font-size: 0.76rem;");
		expect(dockviewTab).toContain("padding: 5px 8px;");
		expect(activeDockviewTab).toContain("background: transparent;");
		expect(activeDockviewTab).toContain("color: var(--text-primary);");
		expect(dockviewTabHover).toContain("background: var(--panel-hover);");
		expect(dockviewTabIcon).toContain("width: 14px;");
		expect(dockviewTabIcon).toContain("height: 14px;");
		expect(dockviewTabIcon).toContain("opacity: 0;");
		expect(dockviewTabIcon).toContain("visibility: hidden;");
		expect(dockviewTabIconVisible).toContain("opacity: 1;");
		expect(dockviewTabIconVisible).toContain("visibility: visible;");
		expect(dockviewContextMenu).toContain("background: var(--panel-raised);");
		expect(dockviewContextMenu).toContain("color: var(--text-primary);");
	});
});

describe("ChatShell composer disabled state", () => {
	test("keeps the composer enabled during channel-history loading when a channel is selected", () => {
		renderChatShell(selectedChannel.id);

		expect(composerProps).toHaveLength(1);
		expect(composerProps[0].disabled).toBe(false);
	});

	test("renders an empty select-a-conversation screen when no channel is selected", () => {
		const html = renderChatShell(null, {
			version: 1,
			activeTabId: null,
			tabs: {},
			layout: null,
		});

		expect(html).toContain("chat-empty");
		expect(html).toContain("chat-empty-image");
		expect(html).toContain("Select a conversation");
		expect(html).not.toContain("chat-body");
		expect(html).not.toContain("channel-header");
		expect(composerProps).toHaveLength(0);
	});
});
