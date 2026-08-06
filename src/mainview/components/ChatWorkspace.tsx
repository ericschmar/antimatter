import { useMemo } from "react";
import { DockviewReact, type IDockviewPanelProps } from "dockview-react";
import type { ChatWorkspaceState } from "../state/chatWorkspace";
import type { MattermostChannel } from "../types";
import { channelLabel } from "../utils/format";

type ChatWorkspaceProps = {
	workspace: ChatWorkspaceState;
	channels: MattermostChannel[];
	users: Record<string, { id: string; username: string; first_name?: string; last_name?: string }>;
	currentUserId: string;
};

type ChatPanelParams = {
	channelId: string;
	title: string;
	type: MattermostChannel["type"];
};

function PlaceholderChatPanel({ params }: IDockviewPanelProps<ChatPanelParams>) {
	return (
		<div className="chat-workspace-placeholder-panel">
			<p className="eyebrow">Dockview chat pane</p>
			<h3>{params.title}</h3>
			<p>{params.channelId}</p>
		</div>
	);
}

const dockviewComponents = {
	chat: PlaceholderChatPanel,
};

export function ChatWorkspace({
	workspace,
	channels,
	users,
	currentUserId,
}: ChatWorkspaceProps) {
	const channelsById = useMemo(
		() => Object.fromEntries(channels.map((channel) => [channel.id, channel])),
		[channels],
	);
	const tabs = useMemo(
		() =>
			Object.values(workspace.tabs).flatMap((tab) => {
				const channel = channelsById[tab.channelId];
				if (!channel) return [];
				return [
					{
						id: tab.id,
						channelId: tab.channelId,
						title: channelLabel(channel, users, currentUserId),
						type: channel.type,
					},
				];
			}),
		[channelsById, currentUserId, users, workspace.tabs],
	);

	if (tabs.length === 0) {
		return null;
	}

	return (
		<section className="chat-workspace-preview" aria-label="Chat workspace preview">
			<div className="dockview-theme-dark chat-workspace-dockview">
				<DockviewReact
					components={dockviewComponents}
					onReady={(event) => {
						for (const tab of tabs) {
							event.api.addPanel({
								id: tab.id,
								component: "chat",
								title: tab.title,
								params: {
									channelId: tab.channelId,
									title: tab.title,
									type: tab.type,
								},
							});
						}
					}}
				/>
			</div>
		</section>
	);
}
