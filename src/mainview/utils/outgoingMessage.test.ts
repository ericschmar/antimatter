import { describe, expect, test } from "bun:test";
import { normalizeOutgoingMessage } from "./outgoingMessage";

describe("normalizeOutgoingMessage", () => {
	test("removes editor-encoded trailing spaces", () => {
		expect(normalizeOutgoingMessage("hello&#x20;")).toBe("hello");
		expect(normalizeOutgoingMessage("hello&#32;")).toBe("hello");
		expect(normalizeOutgoingMessage("hello&nbsp;")).toBe("hello");
	});

	test("removes mixed trailing whitespace and encoded spaces", () => {
		expect(normalizeOutgoingMessage("hello &#x20;\n")).toBe("hello");
	});

	test("preserves encoded spaces inside the message", () => {
		expect(normalizeOutgoingMessage("hello&#x20;there")).toBe(
			"hello&#x20;there",
		);
	});

	test("removes editor markdown escapes from pasted bare URLs", () => {
		expect(
			normalizeOutgoingMessage(
				"https://llnl.servicenowservices.com/idea?id\\=ideas_list\\&sysparm_module_id\\=internal",
			),
		).toBe(
			"https://llnl.servicenowservices.com/idea?id=ideas_list&sysparm_module_id=internal",
		);
	});

	test("preserves markdown escapes outside URLs", () => {
		expect(normalizeOutgoingMessage("literal \\*stars\\*")).toBe(
			"literal \\*stars\\*",
		);
	});
});
