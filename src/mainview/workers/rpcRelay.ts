import type {
	MattermostRpcRequest,
	MattermostRpcResponse,
} from "../../shared/electrobunRpc";
import type {
	HistoryRpcResult,
	WorkerToMainMessage,
} from "./chatHistoryProtocol";

export type RpcRelay = {
	/** MattermostTransport implementation that relays through the main thread. */
	transport: (request: MattermostRpcRequest) => Promise<MattermostRpcResponse>;
	/** Feed a matching rpcResult message back from the main thread. */
	handleResult: (message: HistoryRpcResult) => void;
};

export function createRpcRelay(deps: {
	send: (message: WorkerToMainMessage) => void;
}): RpcRelay {
	let nextRequestId = 1;
	const pending = new Map<
		number,
		{
			resolve: (response: MattermostRpcResponse) => void;
			reject: (error: Error & { status?: number }) => void;
		}
	>();

	return {
		transport(request) {
			const requestId = nextRequestId;
			nextRequestId += 1;
			deps.send({
				kind: "rpcCall",
				requestId,
				path: request.path,
				method: request.method,
				body: request.body,
			});
			return new Promise<MattermostRpcResponse>((resolve, reject) => {
				pending.set(requestId, { resolve, reject });
			});
		},
		handleResult(message) {
			const entry = pending.get(message.requestId);
			if (!entry) return;
			pending.delete(message.requestId);
			if (message.ok || message.status !== undefined) {
				entry.resolve({
					status: message.status ?? (message.ok ? 200 : 0),
					ok: Boolean(message.ok),
					body: "body" in message ? message.body : undefined,
				});
			} else {
				const error: Error & { status?: number } = Object.assign(
					new Error(message.message ?? "rpc failed"),
					{ status: message.status },
				);
				entry.reject(error);
			}
		},
	};
}
