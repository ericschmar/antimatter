import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "bun:test";
import { appendLogLine, formatLogLine, LOG_FILENAME } from "./logger";

test("formatLogLine prepends an ISO timestamp and a bracketed tag", () => {
	const line = formatLogLine(
		Date.UTC(2026, 0, 1, 12, 0, 0, 0),
		"WS",
		["Post event:", { id: "abc" }],
	);
	expect(line).toContain("2026-01-01T12:00:00.000Z");
	expect(line).toContain("[WS]");
	expect(line).toContain("Post event:");
	expect(line).toContain('"id":"abc"');
	expect(line.endsWith("\n")).toBe(true);
});

test("formatLogLine leaves plain strings unquoted", () => {
	const line = formatLogLine(Date.UTC(2026, 0, 1), "renderer", ["hello world"]);
	expect(line.trim()).toBe("2026-01-01T00:00:00.000Z [renderer] hello world");
});

test("appendLogLine creates the directory and appends to the log file", () => {
	const dir = mkdtempSync(join(tmpdir(), "antimatter-log-"));
	try {
		appendLogLine(dir, formatLogLine(Date.now(), "WS", ["first"]));
		appendLogLine(dir, formatLogLine(Date.now(), "WS", ["second"]));
		const content = readFileSync(join(dir, LOG_FILENAME), "utf8");
		expect(content).toContain("first");
		expect(content).toContain("second");
		expect(content.split("\n").filter(Boolean)).toHaveLength(2);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("appendLogLine works when the directory already exists", () => {
	const dir = mkdtempSync(join(tmpdir(), "antimatter-log-"));
	try {
		appendLogLine(dir, formatLogLine(Date.now(), "WS", ["one"]));
		// second call must not throw on an existing dir/file
		appendLogLine(dir, formatLogLine(Date.now(), "WS", ["two"]));
		expect(readFileSync(join(dir, LOG_FILENAME), "utf8")).toContain("two");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
