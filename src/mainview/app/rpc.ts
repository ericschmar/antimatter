import Electrobun, { Electroview } from "electrobun/view";
import type { MattermostClientRPC } from "../../shared/electrobunRpc";

const rpc = Electroview.defineRPC<MattermostClientRPC>({
	maxRequestTime: 30000,
	handlers: {
		requests: {},
		messages: {
			mattermostWebSocketStatus: ({ status, message }) => {
				window.dispatchEvent(
					new CustomEvent("mattermost-websocket-status", {
						detail: { status, message },
					}),
				);
			},
			mattermostWebSocketPost: ({ post }) => {
				window.dispatchEvent(
					new CustomEvent("mattermost-websocket-post", {
						detail: { post },
					}),
				);
			},
			mattermostWebSocketReaction: ({ reaction, removed }) => {
				window.dispatchEvent(
					new CustomEvent("mattermost-websocket-reaction", {
						detail: { reaction, removed },
					}),
				);
			},
			mattermostWebSocketStatusChange: ({ status }) => {
				window.dispatchEvent(
					new CustomEvent("mattermost-websocket-status-change", {
						detail: { status },
					}),
				);
			},
			mattermostWebSocketTyping: ({ channelId, parentId, userId }) => {
				window.dispatchEvent(
					new CustomEvent("mattermost-websocket-typing", {
						detail: { channelId, parentId, userId },
					}),
				);
			},
			mattermostSsoLoginResult: (result) => {
				window.dispatchEvent(
					new CustomEvent("mattermost-sso-login-result", {
						detail: result,
					}),
				);
			},
			channelContextMenuAction: (action) => {
				window.dispatchEvent(
					new CustomEvent("channel-context-menu-action", {
						detail: action,
					}),
				);
			},
			messageContextMenuAction: (action) => {
				window.dispatchEvent(
					new CustomEvent("message-context-menu-action", {
						detail: action,
					}),
				);
			},
			applicationMenuAction: (action) => {
				window.dispatchEvent(
					new CustomEvent("application-menu-action", {
						detail: action,
					}),
				);
			},
			settingsUpdated: ({ settings }) => {
				window.dispatchEvent(
					new CustomEvent("settings-updated", {
						detail: { settings },
					}),
				);
			},
			appUpdateState: (state) => {
				window.dispatchEvent(
					new CustomEvent("app-update-state", {
						detail: state,
					}),
				);
			},
		},
	},
});

export const electrobun = new Electrobun.Electroview({ rpc });
