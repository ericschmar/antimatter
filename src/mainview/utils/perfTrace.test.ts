import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import {
	__flushPerfRenderCounts,
	__resetPerfCache,
	__setPerfEnabled,
	isPerfEnabled,
	markRender,
	traceSync,
} from "./perfTrace";

describe("perfTrace", () => {
	// The module caches `enabled` once at import from localStorage, so a polluted
	// test-local localStorage (mm-clone:perf=1) would otherwise make the first
	// assertion fail before afterEach runs.
	beforeAll(() => {
		__setPerfEnabled(false);
	});

	afterEach(() => {
		__setPerfEnabled(false);
		__resetPerfCache();
	});

	it("is disabled by default", () => {
		expect(isPerfEnabled()).toBe(false);
	});

	it("runs the function and returns its value without logging when disabled", () => {
		__setPerfEnabled(false);
		const debug = spyOn(console, "debug");
		const result = traceSync("work", () => 42);
		expect(result).toBe(42);
		expect(debug).not.toHaveBeenCalled();
		debug.mockRestore();
	});

	it("times and logs when enabled", () => {
		__setPerfEnabled(true);
		const debug = spyOn(console, "debug");
		const result = traceSync("work", () => 7);
		expect(result).toBe(7);
		expect(debug).toHaveBeenCalledTimes(1);
		expect(String(debug.mock.calls[0][0])).toBe("[perf] work: ");
		expect(String(debug.mock.calls[0][1])).toMatch(/ms$/);
		debug.mockRestore();
	});

	it("aggregates render marks until flushed", () => {
		__setPerfEnabled(true);
		const debug = spyOn(console, "debug");
		markRender("MattermostTextPart");
		markRender("MattermostTextPart");
		markRender("MuiMessageItem");
		__flushPerfRenderCounts();
		expect(debug).toHaveBeenCalledTimes(1);
		expect(debug.mock.calls[0][1]).toEqual({
			MattermostTextPart: 2,
			MuiMessageItem: 1,
		});
		debug.mockRestore();
	});

	it("does not count renders when disabled", () => {
		__setPerfEnabled(false);
		const debug = spyOn(console, "debug");
		markRender("MattermostTextPart");
		__flushPerfRenderCounts();
		expect(debug).not.toHaveBeenCalled();
		debug.mockRestore();
	});

	it("flushing twice does not re-log the same counts", () => {
		__setPerfEnabled(true);
		const debug = spyOn(console, "debug");
		markRender("MattermostTextPart");
		__flushPerfRenderCounts();
		__flushPerfRenderCounts();
		expect(debug).toHaveBeenCalledTimes(1);
		debug.mockRestore();
	});
});
