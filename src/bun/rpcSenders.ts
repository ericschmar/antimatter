import type { BrowserWindow } from "electrobun/bun";
import type { MattermostClientRPC, SettingsWindowRPC } from "../shared/electrobunRpc";

type MainWebviewMessages = MattermostClientRPC["webview"]["messages"];
type SettingsWebviewMessages = SettingsWindowRPC["webview"]["messages"];

type MessageSender<TMessages> = {
	send?: Partial<{
		[K in keyof TMessages]: (payload: TMessages[K]) => void;
	}>;
};

export function sendMainWebviewMessage<K extends keyof MainWebviewMessages>(
	window: BrowserWindow,
	message: K,
	payload: MainWebviewMessages[K],
) {
	const rpc = window.webview.rpc as MessageSender<MainWebviewMessages>;
	rpc.send?.[message]?.(payload);
}

export function sendSettingsWebviewMessage<K extends keyof SettingsWebviewMessages>(
	window: BrowserWindow,
	message: K,
	payload: SettingsWebviewMessages[K],
) {
	const rpc = window.webview.rpc as MessageSender<SettingsWebviewMessages>;
	rpc.send?.[message]?.(payload);
}
