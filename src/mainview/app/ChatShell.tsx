import * as Tooltip from "@radix-ui/react-tooltip";
import { Resizable, type ResizeCallbackData } from "react-resizable";
import type { RefObject, SyntheticEvent } from "react";
import { CommandMenu } from "../components/CommandMenu";
import { CreateChannelDialog } from "../components/CreateChannelDialog";
import {
	MessageComposer,
	type MessageComposerHandle,
} from "../components/MessageComposer";
import { MessageTimeline } from "../components/MessageTimeline";
import { Sidebar } from "../components/Sidebar";
import { Titlebar } from "../components/Titlebar";
import { UserPickerDialog } from "../components/UserPickerDialog";
import { MattermostApiClient } from "../mattermostApi";
import type {
	AppSettings,
	ChannelNotificationState,
	ChannelSectionKey,
	MattermostChannel,
	MattermostChannelMember,
	MattermostPost,
	MattermostTeam,
	MattermostUser,
	MattermostUserStatus,
	WebSocketStatus,
} from "../types";
import { channelLabel, initials, isTeamChannel } from "../utils/format";
import { electrobun } from "./rpc";

export function ChatShell({
	addUserOpen,
	api,
	channelEmojis,
	channelMembers,
	channelNotifications,
	channelOrder,
	channels,
	collapsedSections,
	commandOpen,
	composerRef,
	createChannelOpen,
	createDmOpen,
	currentUser,
	editTarget,
	error,
	favoriteChannelSet,
	loadingHistory,
	maxSidebarWidth,
	minSidebarWidth,
	posts,
	replyTarget,
	resolveImageSrc,
	sections,
	selectedChannel,
	selectedChannelId,
	selectedTeam,
	selectedTeamId,
	settings,
	sidebarWidth,
	status,
	teams,
	typingUserIds,
	userColors,
	userImages,
	users,
	userStatuses,
	wsStatus,
	onAddUserToSelectedChannel,
	onArchiveChannel,
	onCancelEdit,
	onCancelReply,
	onCreateChannel,
	onCreateDm,
	onEditMessage,
	onLoadMoreMessages,
	onMoveChannel,
	onOpenSettings,
	onSelectChannel,
	onSelectPost,
	onSelectTeam,
	onSendMessage,
	onSendTyping,
	onSetAddUserOpen,
	onSetChannelEmoji,
	onSetCommandOpen,
	onSetCreateChannelOpen,
	onSetCreateDmOpen,
	onSetError,
	onSetSidebarWidth,
	onShowChannelContextMenu,
	onShowMessageContextMenu,
	onSignOut,
	onStartReply,
	onToggleChannelSection,
	onToggleFavoriteChannel,
	onToggleReaction,
	onUnarchiveChannel,
}: ChatShellProps) {
	const selectedChannelUsers = channelMembers
		.map((member) => users[member.user_id])
		.filter((user): user is MattermostUser => Boolean(user));
	const typingUsers = typingUserIds.map(
		(userId) =>
			users[userId] ?? {
				id: userId,
				username: "Someone",
			},
	);

	function resizeSidebar(_: SyntheticEvent, data: ResizeCallbackData) {
		onSetSidebarWidth(data.size.width);
	}

	return (
		<Tooltip.Provider>
			<div className="window-shell">
				<Titlebar
					onWindowControl={(action) => {
						void electrobun.rpc!.request.windowControl({ action });
					}}
				/>
				<div
					className="app-shell"
					style={{ gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)` }}
				>
					<Resizable
						axis="x"
						height={0}
						maxConstraints={[maxSidebarWidth, 0]}
						minConstraints={[minSidebarWidth, 0]}
						resizeHandles={["e"]}
						width={sidebarWidth}
						onResize={resizeSidebar}
					>
						<div className="resizable-sidebar" style={{ width: sidebarWidth }}>
							<Sidebar
								channelEmojis={channelEmojis}
								channelOrder={channelOrder}
								collapsedSections={collapsedSections}
								currentUser={currentUser}
								favoriteChannelSet={favoriteChannelSet}
								notifications={channelNotifications}
								sections={sections}
								selectedChannelId={selectedChannelId}
								selectedTeam={selectedTeam}
								selectedTeamId={selectedTeamId}
								teams={teams}
								userImages={userImages}
								userStatuses={userStatuses}
								users={users}
								wsStatus={wsStatus}
								onArchiveChannel={onArchiveChannel}
								onMoveChannel={onMoveChannel}
								onSelectChannel={onSelectChannel}
								onSelectTeam={onSelectTeam}
								onSetChannelEmoji={onSetChannelEmoji}
								onShowChannelContextMenu={onShowChannelContextMenu}
								onOpenCreateChannel={() => onSetCreateChannelOpen(true)}
								onOpenCreateDm={() => onSetCreateDmOpen(true)}
								onSignOut={onSignOut}
								onToggleCollapsed={onToggleChannelSection}
								onToggleFavorite={onToggleFavoriteChannel}
								onUnarchiveChannel={onUnarchiveChannel}
							/>
						</div>
					</Resizable>

					<main className="main-panel">
						<header className="channel-header">
							<div>
								<p className="eyebrow">Channel</p>
								<h2>
									{selectedChannel
										? channelLabel(selectedChannel, users, currentUser.id)
										: "Select a channel"}
								</h2>
								{selectedChannel?.purpose ? (
									<p>{selectedChannel.purpose}</p>
								) : null}
							</div>
							<div className="channel-header-actions">
								<Tooltip.Root>
									<Tooltip.Trigger asChild>
										<div className="member-stack" aria-label="Channel members">
											{selectedChannelUsers.slice(0, 5).map((user) => (
												<span className="member-avatar" key={user.id}>
													{userImages[user.id] ? (
														<img alt="" src={userImages[user.id]} />
													) : (
														initials(user.nickname || user.username)
													)}
													<span className={`status-dot ${userStatuses[user.id]?.status ?? "offline"}`} />
												</span>
											))}
											{channelMembers.length > 5 ? (
												<span className="member-count">+{channelMembers.length - 5}</span>
											) : null}
										</div>
									</Tooltip.Trigger>
									<Tooltip.Portal>
										<Tooltip.Content
											className="tooltip-content channel-members-tooltip"
											side="bottom"
											sideOffset={6}
										>
											<div className="channel-members-list">
												{selectedChannelUsers.map((user) => (
													<div key={user.id} className="channel-member-item">
														<span className={`member-status ${userStatuses[user.id]?.status ?? "offline"}`} />
														<span className="member-name">
															{user.nickname || user.username}
														</span>
													</div>
												))}
											</div>
										</Tooltip.Content>
									</Tooltip.Portal>
								</Tooltip.Root>
								{selectedChannel && isTeamChannel(selectedChannel) ? (
									<button className="secondary-action" type="button" onClick={() => onSetAddUserOpen(true)}>
										Add user
									</button>
								) : null}
							</div>
						</header>

						{error ? (
							<div className="inline-error">
								<span>{error}</span>
								<button type="button" onClick={() => onSetError(null)}>
									Dismiss
								</button>
							</div>
						) : null}

						<section className="chat-body">
							<MessageTimeline
								currentUserId={currentUser.id}
								loading={status === "loading"}
								loadingHistory={loadingHistory}
								posts={posts}
								resolveImageSrc={resolveImageSrc}
								typingUsers={typingUsers}
								userColors={userColors}
								userImages={userImages}
								userStatuses={userStatuses}
								users={users}
								onShowMessageContextMenu={onShowMessageContextMenu}
								onReply={onStartReply}
								onToggleReaction={onToggleReaction}
								onLoadMore={onLoadMoreMessages}
							/>
							<MessageComposer
								currentUserId={currentUser.id}
								disabled={!selectedChannelId || status === "loading"}
								editTarget={editTarget}
								ref={composerRef}
								replyTarget={replyTarget}
								userColors={userColors}
								users={users}
								onCancelEdit={onCancelEdit}
								onCancelReply={onCancelReply}
								onEdit={onEditMessage}
								onSend={onSendMessage}
								onTyping={onSendTyping}
							/>
						</section>
					</main>
				</div>
				<CommandMenu
					api={api}
					channels={channels}
					currentUserId={currentUser.id}
					open={commandOpen}
					selectedTeamId={selectedTeamId}
					users={users}
					onClose={() => onSetCommandOpen(false)}
					onCreateDm={(userId) => {
						onSetCommandOpen(false);
						void onCreateDm([userId]);
					}}
					onSelectPost={(post) => {
						onSetCommandOpen(false);
						void onSelectPost(post);
					}}
					onSelectChannel={(channel) => {
						onSetCommandOpen(false);
						void onSelectChannel(channel);
					}}
					onOpenSettings={() => {
						onSetCommandOpen(false);
						onOpenSettings(settings);
					}}
				/>
				<CreateChannelDialog
					open={createChannelOpen}
					onClose={() => onSetCreateChannelOpen(false)}
					onCreate={(displayName, name, type) => void onCreateChannel(displayName, name, type)}
				/>
				<UserPickerDialog
					api={api}
					open={createDmOpen}
					selectedTeamId={selectedTeamId}
					title="Create direct message"
					onClose={() => onSetCreateDmOpen(false)}
					onSubmit={(userIds) => void onCreateDm(userIds)}
				/>
				<UserPickerDialog
					api={api}
					open={addUserOpen}
					selectedTeamId={selectedTeamId}
					title="Add user to channel"
					onClose={() => onSetAddUserOpen(false)}
					onSubmit={(userIds) => {
						const [userId] = userIds;
						if (userId) void onAddUserToSelectedChannel(userId);
					}}
				/>
			</div>
		</Tooltip.Provider>
	);
}

type ChatShellProps = {
	addUserOpen: boolean;
	api: MattermostApiClient | null;
	channelEmojis: Record<string, string>;
	channelMembers: MattermostChannelMember[];
	channelNotifications: ChannelNotificationState;
	channelOrder: Record<string, string[]>;
	channels: MattermostChannel[];
	collapsedSections: Record<ChannelSectionKey, boolean>;
	commandOpen: boolean;
	composerRef: RefObject<MessageComposerHandle | null>;
	createChannelOpen: boolean;
	createDmOpen: boolean;
	currentUser: MattermostUser;
	editTarget: MattermostPost | null;
	error: string | null;
	favoriteChannelSet: Set<string>;
	loadingHistory: boolean;
	maxSidebarWidth: number;
	minSidebarWidth: number;
	posts: MattermostPost[];
	replyTarget: MattermostPost | null;
	resolveImageSrc: (src: string) => Promise<string>;
	sections: Record<ChannelSectionKey, MattermostChannel[]>;
	selectedChannel: MattermostChannel | undefined;
	selectedChannelId: string | null;
	selectedTeam: MattermostTeam | undefined;
	selectedTeamId: string | null;
	settings: AppSettings;
	sidebarWidth: number;
	status: "idle" | "loading" | "ready" | "error";
	teams: MattermostTeam[];
	typingUserIds: string[];
	userColors: Record<string, string>;
	userImages: Record<string, string>;
	users: Record<string, MattermostUser>;
	userStatuses: Record<string, MattermostUserStatus>;
	wsStatus: WebSocketStatus;
	onAddUserToSelectedChannel: (userId: string) => Promise<void>;
	onArchiveChannel: (channelId: string) => void;
	onCancelEdit: () => void;
	onCancelReply: () => void;
	onCreateChannel: (displayName: string, name: string, type: "O" | "P") => Promise<void>;
	onCreateDm: (userIds: string[]) => Promise<void>;
	onEditMessage: (post: MattermostPost, message: string) => Promise<void>;
	onLoadMoreMessages: () => Promise<void>;
	onMoveChannel: (section: ChannelSectionKey, channelIds: string[]) => void;
	onOpenSettings: (settings: AppSettings) => void;
	onSelectChannel: (channel: MattermostChannel) => Promise<void>;
	onSelectPost: (post: MattermostPost) => Promise<void>;
	onSelectTeam: (team: MattermostTeam) => Promise<void>;
	onSendMessage: (message: string, rootId?: string, files?: File[]) => Promise<void>;
	onSendTyping: (rootId?: string) => Promise<void>;
	onSetAddUserOpen: (open: boolean) => void;
	onSetChannelEmoji: (channelId: string, emoji: string) => void;
	onSetCommandOpen: (open: boolean) => void;
	onSetCreateChannelOpen: (open: boolean) => void;
	onSetCreateDmOpen: (open: boolean) => void;
	onSetError: (error: string | null) => void;
	onSetSidebarWidth: (width: number) => void;
	onShowChannelContextMenu: (channel: MattermostChannel) => void;
	onShowMessageContextMenu: (post: MattermostPost) => void;
	onSignOut: () => void;
	onStartReply: (post: MattermostPost) => void;
	onToggleChannelSection: (section: ChannelSectionKey) => void;
	onToggleFavoriteChannel: (channelId: string) => void;
	onToggleReaction: (post: MattermostPost, emojiName: string) => Promise<void>;
	onUnarchiveChannel: (channelId: string) => void;
};
