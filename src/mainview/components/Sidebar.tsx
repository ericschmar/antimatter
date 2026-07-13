import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
	ChevronDown,
	ChevronRight,
	GripVertical,
	MessageCircle,
	MessageSquare,
	Plus,
	Star,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ChannelContextMenuAction } from "../../shared/electrobunRpc";
import type {
	ChannelNotificationState,
	ChannelSectionKey,
	MattermostChannel,
	MattermostTeam,
	MattermostUser,
	MattermostUserStatus,
	WebSocketStatus,
} from "../types";
import { sortChannelsForSection } from "../utils/channelNavigation";
import { channelLabel, initials } from "../utils/format";
import { showTeamUnreadDot } from "../utils/teamUnread";
import { EmojiPickerPanel } from "./EmojiPickerPopover";
import { UserMenu } from "./UserMenu";
import "./Sidebar.css";

export function Sidebar({
	channelEmojis,
	channelOrder,
	collapsedSections,
	currentUser,
	favoriteChannelSet,
	sections,
	selectedChannelId,
	selectedTeam,
	selectedTeamId,
	teams,
	wsStatus,
	notifications,
	teamUnread,
	userImages,
	userStatuses,
	users,
	onArchiveChannel,
	onMoveChannel,
	onSelectChannel,
	onSelectTeam,
	onSetChannelEmoji,
	onShowChannelContextMenu,
	onOpenCreateChannel,
	onOpenCreateDm,
	onSignOut,
	onToggleCollapsed,
	onToggleFavorite,
	onUnarchiveChannel,
}: {
	channelEmojis: Record<string, string>;
	channelOrder: Readonly<Record<string, readonly string[]>>;
	collapsedSections: Record<ChannelSectionKey, boolean>;
	currentUser: MattermostUser;
	favoriteChannelSet: Set<string>;
	sections: Record<ChannelSectionKey, MattermostChannel[]>;
	selectedChannelId: string | null;
	selectedTeam: MattermostTeam | undefined;
	selectedTeamId: string | null;
	teams: MattermostTeam[];
	wsStatus: WebSocketStatus;
	notifications: ChannelNotificationState;
	teamUnread: Record<string, boolean>;
	userImages: Record<string, string>;
	userStatuses: Record<string, MattermostUserStatus>;
	users: Record<string, MattermostUser>;
	onArchiveChannel: (channelId: string) => void;
	onMoveChannel: (section: ChannelSectionKey, channelIds: string[]) => void;
	onSelectChannel: (channel: MattermostChannel) => Promise<void>;
	onSelectTeam: (team: MattermostTeam) => Promise<void>;
	onSetChannelEmoji: (channelId: string, emoji: string) => void;
	onShowChannelContextMenu: (channel: MattermostChannel) => void;
	onOpenCreateChannel: () => void;
	onOpenCreateDm: () => void;
	onSignOut: () => void;
	onToggleCollapsed: (section: ChannelSectionKey) => void;
	onToggleFavorite: (channelId: string) => void;
	onUnarchiveChannel: (channelId: string) => void;
}) {
	const [emojiPickerChannelId, setEmojiPickerChannelId] = useState<
		string | null
	>(null);
	const emojiPickerChannel = emojiPickerChannelId
		? findChannelById(sections, emojiPickerChannelId)
		: null;
	const emojiPicker = emojiPickerChannel ? (
		<div
			className="emoji-picker-overlay"
			role="presentation"
			onMouseDown={() => setEmojiPickerChannelId(null)}
		>
			<div
				aria-label={`Set emoji for ${channelLabel(emojiPickerChannel, users, currentUser.id)}`}
				className="emoji-picker-modal emoji-picker-content"
				role="dialog"
				onMouseDown={(event) => event.stopPropagation()}
			>
				<EmojiPickerPanel
					onSelectEmoji={(emoji) => {
						onSetChannelEmoji(emojiPickerChannel.id, emoji);
						setEmojiPickerChannelId(null);
					}}
				/>
			</div>
		</div>
	) : null;

	useEffect(() => {
		function handleContextMenuAction(event: Event) {
			const action = (event as CustomEvent<ChannelContextMenuAction>).detail;
			if (action.action === "set-emoji")
				setEmojiPickerChannelId(action.channelId);
			if (action.action === "archive") onArchiveChannel(action.channelId);
			if (action.action === "unarchive") onUnarchiveChannel(action.channelId);
		}

		window.addEventListener(
			"channel-context-menu-action",
			handleContextMenuAction,
		);
		return () =>
			window.removeEventListener(
				"channel-context-menu-action",
				handleContextMenuAction,
			);
	}, [onArchiveChannel, onUnarchiveChannel]);

	useEffect(() => {
		if (!emojiPickerChannelId) return;
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") setEmojiPickerChannelId(null);
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [emojiPickerChannelId]);

	return (
		<aside className="sidebar">
			<div className="sidebar-header">
				<div>
					<p className="eyebrow">Team</p>
					<h1>{selectedTeam?.display_name ?? "No team"}</h1>
				</div>
				<UserMenu
					user={currentUser}
					imageSrc={userImages[currentUser.id]}
					status={userStatuses[currentUser.id]?.status}
					wsStatus={wsStatus}
					onSignOut={onSignOut}
				/>
			</div>

			<Tabs.Root
				value={selectedTeamId ?? ""}
				onValueChange={(id) => {
					const team = teams.find((item) => item.id === id);
					if (team) void onSelectTeam(team);
				}}
			>
				<Tabs.List className="team-tabs" aria-label="Teams">
					{teams.map((team) => (
						<Tooltip.Root key={team.id}>
							<Tooltip.Trigger asChild>
								<Tabs.Trigger className="team-tab" value={team.id}>
									{initials(team.display_name || team.name)}
									{showTeamUnreadDot(teamUnread, team.id, selectedTeamId) ? (
										<span className="team-tab-unread-dot" aria-hidden />
									) : null}
								</Tabs.Trigger>
							</Tooltip.Trigger>
							<Tooltip.Portal>
								<Tooltip.Content
									className="tooltip-content"
									side="bottom"
									sideOffset={6}
								>
									{team.display_name || team.name}
								</Tooltip.Content>
							</Tooltip.Portal>
						</Tooltip.Root>
					))}
				</Tabs.List>
			</Tabs.Root>

			<ScrollArea.Root className="channel-scroll">
				<ScrollArea.Viewport>
					<nav className="channel-list" aria-label="Channels">
						<ChannelSection
							channelEmojis={channelEmojis}
							channels={sections["favorites"]}
							collapsed={collapsedSections["favorites"]}
							emptyLabel="No favorite channels."
							favoriteChannelSet={favoriteChannelSet}
							label="Favorites"
							notifications={notifications}
							order={channelOrder["favorites"] ?? []}
							section="favorites"
							selectedChannelId={selectedChannelId}
							currentUserId={currentUser.id}
							users={users}
							userImages={userImages}
							userStatuses={userStatuses}
							onMoveChannel={onMoveChannel}
							onSelectChannel={onSelectChannel}
							onShowChannelContextMenu={onShowChannelContextMenu}
							onToggleCollapsed={() => onToggleCollapsed("favorites")}
							onToggleFavorite={onToggleFavorite}
						/>
						<ChannelSection
							channelEmojis={channelEmojis}
							channels={sections["channels"]}
							collapsed={collapsedSections["channels"]}
							emptyLabel="No channels found."
							favoriteChannelSet={favoriteChannelSet}
							label="Channels"
							notifications={notifications}
							order={channelOrder["channels"] ?? []}
							section="channels"
							selectedChannelId={selectedChannelId}
							currentUserId={currentUser.id}
							users={users}
							userImages={userImages}
							userStatuses={userStatuses}
							actionLabel="Create channel"
							onAction={onOpenCreateChannel}
							onMoveChannel={onMoveChannel}
							onSelectChannel={onSelectChannel}
							onShowChannelContextMenu={onShowChannelContextMenu}
							onToggleCollapsed={() => onToggleCollapsed("channels")}
							onToggleFavorite={onToggleFavorite}
						/>
						<ChannelSection
							channelEmojis={channelEmojis}
							channels={sections["dms"]}
							collapsed={collapsedSections["dms"]}
							emptyLabel="No direct messages."
							favoriteChannelSet={favoriteChannelSet}
							label="Direct Messages"
							notifications={notifications}
							order={channelOrder["dms"] ?? []}
							section="dms"
							selectedChannelId={selectedChannelId}
							currentUserId={currentUser.id}
							users={users}
							userImages={userImages}
							userStatuses={userStatuses}
							actionLabel="Create DM"
							onAction={onOpenCreateDm}
							onMoveChannel={onMoveChannel}
							onSelectChannel={onSelectChannel}
							onShowChannelContextMenu={onShowChannelContextMenu}
							onToggleCollapsed={() => onToggleCollapsed("dms")}
							onToggleFavorite={onToggleFavorite}
						/>
						<ChannelSection
							channelEmojis={channelEmojis}
							channels={sections["archived"]}
							collapsed={collapsedSections["archived"]}
							emptyLabel="No archived channels."
							favoriteChannelSet={favoriteChannelSet}
							label="Archived"
							notifications={notifications}
							order={channelOrder["archived"] ?? []}
							section="archived"
							selectedChannelId={selectedChannelId}
							currentUserId={currentUser.id}
							users={users}
							userImages={userImages}
							userStatuses={userStatuses}
							onMoveChannel={onMoveChannel}
							onSelectChannel={onSelectChannel}
							onShowChannelContextMenu={onShowChannelContextMenu}
							onToggleCollapsed={() => onToggleCollapsed("archived")}
							onToggleFavorite={onToggleFavorite}
						/>
					</nav>
				</ScrollArea.Viewport>
				<ScrollArea.Scrollbar orientation="vertical" />
			</ScrollArea.Root>
			{emojiPicker ? createPortal(emojiPicker, document.body) : null}
		</aside>
	);
}

function ChannelSection({
	channelEmojis,
	channels,
	collapsed,
	emptyLabel,
	favoriteChannelSet,
	label,
	notifications,
	order,
	section,
	selectedChannelId,
	currentUserId,
	users,
	userImages,
	userStatuses,
	actionLabel,
	onAction,
	onMoveChannel,
	onSelectChannel,
	onShowChannelContextMenu,
	onToggleCollapsed,
	onToggleFavorite,
}: {
	channelEmojis: Record<string, string>;
	channels: MattermostChannel[];
	collapsed: boolean;
	emptyLabel: string;
	favoriteChannelSet: Set<string>;
	label: string;
	notifications: ChannelNotificationState;
	order: readonly string[];
	section: ChannelSectionKey;
	selectedChannelId: string | null;
	currentUserId: string;
	users: Record<string, MattermostUser>;
	userImages: Record<string, string>;
	userStatuses: Record<string, MattermostUserStatus>;
	actionLabel?: string;
	onAction?: () => void;
	onMoveChannel: (section: ChannelSectionKey, channelIds: string[]) => void;
	onSelectChannel: (channel: MattermostChannel) => Promise<void>;
	onShowChannelContextMenu: (channel: MattermostChannel) => void;
	onToggleCollapsed: () => void;
	onToggleFavorite: (channelId: string) => void;
}) {
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);
	const orderedChannels = sortChannelsForSection(
		channels,
		order,
		users,
		currentUserId,
		section,
	);
	const channelIds = orderedChannels.map((channel) => channel.id);

	function handleDragEnd(event: DragEndEvent) {
		const { active, over } = event;
		if (!over || active.id === over.id) return;
		const oldIndex = channelIds.indexOf(String(active.id));
		const newIndex = channelIds.indexOf(String(over.id));
		if (oldIndex < 0 || newIndex < 0) return;
		onMoveChannel(section, arrayMove(channelIds, oldIndex, newIndex));
	}

	return (
		<section className="channel-section">
			<button
				aria-expanded={!collapsed}
				className="channel-section-trigger"
				type="button"
				onClick={onToggleCollapsed}
			>
				{collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
				<span>{label}</span>
				<span className="channel-count">{channels.length}</span>
			</button>
			{collapsed ? null : (
				<DndContext
					collisionDetection={closestCenter}
					sensors={sensors}
					onDragEnd={handleDragEnd}
				>
					<SortableContext
						items={channelIds}
						strategy={verticalListSortingStrategy}
					>
						<div className="channel-section-content">
							{orderedChannels.map((channel) => (
								<SortableChannelRow
									channel={channel}
									channelEmoji={channelEmojis[channel.id]}
									favorite={favoriteChannelSet.has(channel.id)}
									key={channel.id}
									notification={notifications[channel.id]}
									section={section}
									selected={channel.id === selectedChannelId}
									currentUserId={currentUserId}
									users={users}
									userImages={userImages}
									userStatuses={userStatuses}
									onSelectChannel={onSelectChannel}
									onShowChannelContextMenu={onShowChannelContextMenu}
									onToggleFavorite={onToggleFavorite}
								/>
							))}
							{channels.length === 0 ? (
								<div className="sidebar-empty">{emptyLabel}</div>
							) : null}
							{onAction ? (
								<button
									className="channel-create-button"
									type="button"
									onClick={onAction}
								>
									<Plus size={14} />
									{actionLabel}
								</button>
							) : null}
						</div>
					</SortableContext>
				</DndContext>
			)}
		</section>
	);
}

function SortableChannelRow({
	channel,
	channelEmoji,
	favorite,
	notification,
	section,
	selected,
	currentUserId,
	users,
	userImages,
	userStatuses,
	onSelectChannel,
	onShowChannelContextMenu,
	onToggleFavorite,
}: {
	channel: MattermostChannel;
	channelEmoji?: string;
	favorite: boolean;
	notification?: { unread: boolean; mention: boolean };
	section: ChannelSectionKey;
	selected: boolean;
	currentUserId: string;
	users: Record<string, MattermostUser>;
	userImages: Record<string, string>;
	userStatuses: Record<string, MattermostUserStatus>;
	onSelectChannel: (channel: MattermostChannel) => Promise<void>;
	onShowChannelContextMenu: (channel: MattermostChannel) => void;
	onToggleFavorite: (channelId: string) => void;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({
		id: channel.id,
	});
	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
	};
	const icon =
		channelEmoji || (channel.type === "D" || channel.type === "G" ? null : "#");
	const showUnreadDot = notification?.unread && icon === "#";
	const otherUserId =
		channel.type === "D"
			? channel.name.split("__").find((id) => id !== currentUserId)
			: null;
	const otherUser = otherUserId ? users[otherUserId] : undefined;
	const status = otherUserId ? userStatuses[otherUserId]?.status : undefined;

	return (
		<div
			className={[
				"channel-row",
				selected ? "active" : "",
				notification?.unread ? "unread" : "",
				notification?.mention ? "mentioned" : "",
				favorite && section === "favorites" ? "favorite-section" : "",
				isDragging ? "dragging" : "",
			]
				.filter(Boolean)
				.join(" ")}
			ref={setNodeRef}
			style={style}
		>
			<button
				className="drag-handle"
				type="button"
				{...attributes}
				{...listeners}
			>
				<GripVertical size={13} />
			</button>
			<button
				className="channel-select"
				type="button"
				onContextMenu={(event) => {
					event.preventDefault();
					onShowChannelContextMenu(channel);
				}}
				onClick={() => void onSelectChannel(channel)}
			>
				{icon ? (
					<span
						aria-hidden={showUnreadDot ? "true" : undefined}
						className={showUnreadDot ? "channel-unread-dot" : "channel-emoji"}
					>
						{showUnreadDot ? null : icon}
					</span>
				) : otherUserId ? (
					<span className="dm-avatar-shell">
						<span className="dm-avatar">
							{userImages[otherUserId] ? (
								<img alt="" src={userImages[otherUserId]} />
							) : (
								initials(
									otherUser?.nickname ||
										otherUser?.username ||
										channelLabel(channel, users, currentUserId),
								)
							)}
						</span>
						<span className={`status-dot ${status ?? "offline"}`} />
					</span>
				) : channel.type === "G" ? (
					<MessageSquare size={16} />
				) : (
					<MessageCircle size={16} />
				)}
				<span>{channelLabel(channel, users, currentUserId)}</span>
				{notification?.mention ? (
					<span className="mention-badge">!</span>
				) : null}
			</button>
			<Tooltip.Root>
				<Tooltip.Trigger asChild>
					<button
						aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
						className={favorite ? "favorite-toggle active" : "favorite-toggle"}
						type="button"
						onClick={() => onToggleFavorite(channel.id)}
					>
						<Star fill={favorite ? "currentColor" : "none"} size={14} />
					</button>
				</Tooltip.Trigger>
				<Tooltip.Portal>
					<Tooltip.Content
						className="tooltip-content"
						side="right"
						sideOffset={6}
					>
						{favorite ? "Remove from favorites" : "Add to favorites"}
					</Tooltip.Content>
				</Tooltip.Portal>
			</Tooltip.Root>
		</div>
	);
}

function findChannelById(
	sections: Record<ChannelSectionKey, MattermostChannel[]>,
	channelId: string,
) {
	return [...sections.favorites, ...sections.channels, ...sections.dms].find(
		(channel) => channel.id === channelId,
	);
}
