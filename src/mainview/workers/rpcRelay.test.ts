import { describe, expect, test } from "bun:test";
import type { WorkerToMainMessage } from "./chatHistoryProtocol";
import { createRpcRelay } from "./rpcRelay";

describe("createRpcRelay", () => {
	test("posts rpcCall without credentials and resolves on the matching result", async () => {
		const sent: WorkerToMainMessage[] = [];
		const relay = createRpcRelay({ send: (msg) => sent.push(msg) });

		const pending = relay.transport({
			serverUrl: "https://secret.example.com",
			token: "super-secret",
			path: "/channels/ch1/posts",
			method: "GET",
		});

		const call = sent[0];
		expect(call.kind).toBe("rpcCall");
		if (call.kind !== "rpcCall") return;
		expect(call.path).toBe("/channels/ch1/posts");
		expect(call.method).toBe("GET");
		// Credentials must never cross into the worker protocol.
		expect(JSON.stringify(call)).not.toContain("secret");

		relay.handleResult({
			kind: "rpcResult",
			requestId: call.requestId,
			ok: true,
			status: 200,
			body: { order: [] },
		});

		await expect(pending).resolves.toEqual({
			status: 200,
			ok: true,
			body: { order: [] },
			headers: undefined,
		});
	});

	test("resolves http-level errors so the api client builds the MattermostApiError", async () => {
		const sent: WorkerToMainMessage[] = [];
		const relay = createRpcRelay({ send: (msg) => sent.push(msg) });

		const pending = relay.transport({ serverUrl: "s", token: "t", path: "/x" });
		const call = sent[0];
		if (call?.kind !== "rpcCall") throw new Error("expected rpcCall");

		relay.handleResult({
			kind: "rpcResult",
			requestId: call.requestId,
			ok: false,
			status: 404,
			body: { message: "not found" },
		});

		await expect(pending).resolves.toEqual({
			status: 404,
			ok: false,
			body: { message: "not found" },
			headers: undefined,
		});
	});

	test("rejects when the rpc itself failed without a status", async () => {
		const sent: WorkerToMainMessage[] = [];
		const relay = createRpcRelay({ send: (msg) => sent.push(msg) });

		const pending = relay.transport({ serverUrl: "s", token: "t", path: "/x" });
		const call = sent[0];
		if (call?.kind !== "rpcCall") throw new Error("expected rpcCall");

		relay.handleResult({
			kind: "rpcResult",
			requestId: call.requestId,
			ok: false,
			message: "rpc unavailable",
		});

		await expect(pending).rejects.toThrow("rpc unavailable");
	});

	test("ignores results for unknown request ids", () => {
		const relay = createRpcRelay({ send: () => {} });

		expect(() =>
			relay.handleResult({
				kind: "rpcResult",
				requestId: 999,
				ok: true,
				status: 200,
				body: null,
			}),
		).not.toThrow();
	});
});
