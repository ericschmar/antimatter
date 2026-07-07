import { test, expect } from "bun:test";
import { rendererLogVia } from "./rendererLog";

test("rendererLogVia formats a timestamped, tagged line and forwards it to bun", () => {
	const sent: { line: string }[] = [];
	const send = (payload: { line: string }) => sent.push(payload);

	rendererLogVia(send, "renderer", ["post received", { id: "abc" }], Date.UTC(2026, 0, 1, 12, 0, 0, 0));

	expect(sent).toHaveLength(1);
	const line = sent[0].line;
	expect(line).toContain("2026-01-01T12:00:00.000Z");
	expect(line).toContain("[renderer]");
	expect(line).toContain("post received");
	expect(line).toContain('"id":"abc"');
	expect(line.endsWith("\n")).toBe(true);
});

test("rendererLogVia leaves plain-string args unquoted", () => {
	const sent: { line: string }[] = [];
	rendererLogVia((p) => sent.push(p), "Notification", ["Requesting from renderer"], Date.UTC(2026, 0, 1));

	expect(sent[0].line.trim()).toBe(
		"2026-01-01T00:00:00.000Z [Notification] Requesting from renderer",
	);
});

test("rendererLogVia defaults `now` to the current wall-clock time", () => {
	const before = Date.now();
	const sent: { line: string }[] = [];
	rendererLogVia((p) => sent.push(p), "renderer", ["hi"]);
	const after = Date.now();

	const ts = Date.parse(sent[0].line.slice(0, 24));
	expect(ts).toBeGreaterThanOrEqual(before);
	expect(ts).toBeLessThanOrEqual(after);
});
