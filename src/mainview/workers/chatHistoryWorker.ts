import { MattermostApiClient } from "../mattermostApi";
import type { MainToWorkerMessage } from "./chatHistoryProtocol";
import { createHistoryCache } from "./historyCache";
import { loadChannelHistoryWaterfall } from "./historyWaterfall";
import { createLoadQueue } from "./loadQueue";
import { createRpcRelay } from "./rpcRelay";
import { createWorkerCore } from "./workerCore";

// Worker entry: wiring only. Runs as a classic (IIFE) worker bundled to
// views/chatHistoryWorker/chatHistoryWorker.js; all requests are relayed
// through the main thread, so credentials never reach this scope.

const relay = createRpcRelay({
	send: (message) => {
		self.postMessage(message);
	},
});

const api = new MattermostApiClient(
	// serverUrl/token are placeholder values: the relay strips them before
	// posting and the main thread injects the real credentials.
	{ serverUrl: "https://relay.invalid", token: "relay" },
	relay.transport,
);

const core = createWorkerCore({
	cache: createHistoryCache(),
	queue: createLoadQueue(),
	load: (channelId, currentUserId) =>
		loadChannelHistoryWaterfall(api, channelId, currentUserId),
	send: (message) => {
		self.postMessage(message);
	},
});

self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
	const message = event.data;
	if (message.kind === "rpcResult") {
		relay.handleResult(message);
		return;
	}
	core.handle(message);
};
