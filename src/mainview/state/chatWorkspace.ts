export type ChatPanelPlacement = "right" | "below";

export type ChatTabState = {
	id: string;
	channelId: string;
	teamId: string | null;
	title: string;
	position?: {
		referenceTabId: string;
		placement: ChatPanelPlacement;
	};
};

export type ChatWorkspaceState = {
	version: 1;
	activeTabId: string | null;
	tabs: Record<string, ChatTabState>;
	layout: unknown;
};

export type PersistedChatWorkspaceTabs = {
	version: 1;
	activeTabId: string | null;
	tabs: Record<string, ChatTabState>;
	layout?: unknown;
};

export type ChatViewState = {
	draftMarkdown: string;
	replyTargetId: string | null;
	editTargetId: string | null;
	scrollAnchorPostId?: string;
	composerHeight?: number;
};

export type ChatViewStateByChannel = Record<string, ChatViewState>;

export type OpenChatTabInput = {
	channelId: string;
	teamId: string | null;
	title: string;
	duplicate?: boolean;
	position?: {
		referenceTabId: string;
		placement: ChatPanelPlacement;
	};
};

export function createEmptyChatWorkspaceState(): ChatWorkspaceState {
	return {
		version: 1,
		activeTabId: null,
		tabs: {},
		layout: null,
	};
}

export function createChatWorkspaceStateFromTabs(
	persistedTabs: PersistedChatWorkspaceTabs | undefined,
): ChatWorkspaceState {
	if (
		persistedTabs?.version !== 1 ||
		!persistedTabs.tabs ||
		typeof persistedTabs.tabs !== "object" ||
		Array.isArray(persistedTabs.tabs)
	) {
		return createEmptyChatWorkspaceState();
	}

	const activeTabId =
		persistedTabs.activeTabId && persistedTabs.tabs[persistedTabs.activeTabId]
			? persistedTabs.activeTabId
			: (Object.keys(persistedTabs.tabs)[0] ?? null);

	return {
		version: 1,
		activeTabId,
		tabs: persistedTabs.tabs,
		layout: persistedTabs.layout ?? null,
	};
}

export function getPersistedChatWorkspaceTabs(
	workspace: ChatWorkspaceState,
): PersistedChatWorkspaceTabs {
	return {
		version: 1,
		activeTabId: workspace.activeTabId,
		tabs: workspace.tabs,
		layout: workspace.layout ?? undefined,
	};
}

export function getChannelTabId(channelId: string): string {
	return `channel:${channelId}`;
}

export function getChatTabId(channelId: string): string {
	return getChannelTabId(channelId);
}

export function createEmptyChatViewState(): ChatViewState {
	return {
		draftMarkdown: "",
		replyTargetId: null,
		editTargetId: null,
	};
}

export function updateChatViewState(
	stateByChannel: ChatViewStateByChannel,
	channelId: string,
	update: (state: ChatViewState) => ChatViewState,
): ChatViewStateByChannel {
	return {
		...stateByChannel,
		[channelId]: update(
			stateByChannel[channelId] ?? createEmptyChatViewState(),
		),
	};
}

export function openChatTab(
	workspace: ChatWorkspaceState,
	input: OpenChatTabInput,
): ChatWorkspaceState {
	const existingTab = input.duplicate
		? undefined
		: Object.values(workspace.tabs).find(
				(tab) => tab.channelId === input.channelId,
			);
	const tabId = existingTab?.id ?? getNextPanelId(workspace.tabs);

	return {
		...workspace,
		activeTabId: tabId,
		layout: input.position ? null : workspace.layout,
		tabs: {
			...workspace.tabs,
			[tabId]: existingTab ?? {
				id: tabId,
				channelId: input.channelId,
				teamId: input.teamId,
				title: input.title,
				position: input.position,
			},
		},
	};
}

export function activateChatTab(
	workspace: ChatWorkspaceState,
	tabId: string,
): ChatWorkspaceState {
	if (!workspace.tabs[tabId]) {
		return workspace;
	}

	return {
		...workspace,
		activeTabId: tabId,
	};
}

export function closeChatTab(
	workspace: ChatWorkspaceState,
	tabId: string,
): ChatWorkspaceState {
	if (!workspace.tabs[tabId]) {
		return workspace;
	}

	const tabs = { ...workspace.tabs };
	delete tabs[tabId];

	return {
		...workspace,
		activeTabId:
			workspace.activeTabId === tabId
				? (Object.keys(tabs)[0] ?? null)
				: workspace.activeTabId,
		tabs,
	};
}

export function updateChatWorkspaceLayout(
	workspace: ChatWorkspaceState,
	layout: unknown,
): ChatWorkspaceState {
	return {
		...workspace,
		layout,
		tabs: Object.fromEntries(
			Object.entries(workspace.tabs).map(([id, tab]) => [
				id,
				{ ...tab, position: undefined },
			]),
		),
	};
}

export function removeInvalidChatTabs(
	workspace: ChatWorkspaceState,
	validChannelIds: ReadonlySet<string>,
): ChatWorkspaceState {
	const tabs = Object.fromEntries(
		Object.entries(workspace.tabs).filter(([, tab]) =>
			validChannelIds.has(tab.channelId),
		),
	);
	const activeTabId =
		workspace.activeTabId && tabs[workspace.activeTabId]
			? workspace.activeTabId
			: (Object.keys(tabs)[0] ?? null);

	return {
		...workspace,
		activeTabId,
		tabs,
	};
}

export function getActiveChatTab(
	workspace: ChatWorkspaceState,
): ChatTabState | null {
	return workspace.activeTabId
		? (workspace.tabs[workspace.activeTabId] ?? null)
		: null;
}

export function getSelectedChannelId(
	workspace: ChatWorkspaceState,
): string | null {
	return getActiveChatTab(workspace)?.channelId ?? null;
}

function getNextPanelId(tabs: Record<string, ChatTabState>) {
	let index = 1;
	while (tabs[`chat-panel-${index}`]) index += 1;
	return `chat-panel-${index}`;
}
