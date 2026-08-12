import { proxy } from "valtio";
import {
	activateChatTab,
	type ChatViewState,
	type ChatViewStateByChannel,
	type ChatWorkspaceState,
	closeChatTab,
	createEmptyChatWorkspaceState,
	type OpenChatTabInput,
	openChatTab,
	removeInvalidChatTabs,
	updateChatViewState,
	updateChatWorkspaceLayout,
} from "./chatWorkspace";

export type ChatWorkspaceStoreState = {
	workspace: ChatWorkspaceState;
	chatViewStates: ChatViewStateByChannel;
};

export const chatWorkspaceStore = proxy<ChatWorkspaceStoreState>({
	workspace: createEmptyChatWorkspaceState(),
	chatViewStates: {},
});

function applyViewUpdate(
	viewId: string,
	update: (state: ChatViewState) => ChatViewState,
) {
	chatWorkspaceStore.chatViewStates = updateChatViewState(
		chatWorkspaceStore.chatViewStates,
		viewId,
		update,
	);
}

export const chatWorkspaceActions = {
	activateTab(tabId: string) {
		chatWorkspaceStore.workspace = activateChatTab(
			chatWorkspaceStore.workspace,
			tabId,
		);
	},
	clearEdit(viewId: string) {
		applyViewUpdate(viewId, (state) => ({ ...state, editTargetId: null }));
	},
	clearReply(viewId: string) {
		applyViewUpdate(viewId, (state) => ({ ...state, replyTargetId: null }));
	},
	closeTab(tabId: string) {
		chatWorkspaceStore.workspace = closeChatTab(
			chatWorkspaceStore.workspace,
			tabId,
		);
	},
	openTab(input: OpenChatTabInput) {
		chatWorkspaceStore.workspace = openChatTab(
			chatWorkspaceStore.workspace,
			input,
		);
	},
	removeInvalidTabs(validChannelIds: ReadonlySet<string>) {
		chatWorkspaceStore.workspace = removeInvalidChatTabs(
			chatWorkspaceStore.workspace,
			validChannelIds,
		);
	},
	replaceWorkspace(workspace: ChatWorkspaceState) {
		chatWorkspaceStore.workspace = workspace;
	},
	reset() {
		chatWorkspaceStore.workspace = createEmptyChatWorkspaceState();
		chatWorkspaceStore.chatViewStates = {};
	},
	setComposerHeight(viewId: string, height: number) {
		applyViewUpdate(viewId, (state) => ({ ...state, composerHeight: height }));
	},
	setDraft(viewId: string, draftMarkdown: string) {
		applyViewUpdate(viewId, (state) => ({ ...state, draftMarkdown }));
	},
	setEditTarget(viewId: string, postId: string) {
		applyViewUpdate(viewId, (state) => ({
			...state,
			editTargetId: postId,
			replyTargetId: null,
		}));
	},
	setLayout(layout: unknown) {
		chatWorkspaceStore.workspace = updateChatWorkspaceLayout(
			chatWorkspaceStore.workspace,
			layout,
		);
	},
	setReplyTarget(viewId: string, postId: string) {
		applyViewUpdate(viewId, (state) => ({
			...state,
			editTargetId: null,
			replyTargetId: postId,
		}));
	},
	setScrollAnchor(viewId: string, postId: string) {
		applyViewUpdate(viewId, (state) => ({
			...state,
			scrollAnchorPostId: postId,
		}));
	},
};
