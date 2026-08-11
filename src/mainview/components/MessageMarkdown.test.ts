import { describe, expect, it } from "bun:test";
import { markdownPropsEqual } from "./MessageMarkdown";

const stableResolveImageSrc = (src: string) => Promise.resolve(src);

const props = (
	overrides: Partial<{
		currentUsername: string | undefined;
		markdown: string;
		resolveImageSrc: (src: string) => Promise<string>;
		useNewComposer: boolean;
	}> = {},
) => ({
	currentUsername: "alice" as string | undefined,
	markdown: "hello",
	resolveImageSrc: stableResolveImageSrc,
	useNewComposer: false,
	...overrides,
});

describe("markdownPropsEqual", () => {
	it("returns true when all props are equal", () => {
		expect(markdownPropsEqual(props(), props())).toBe(true);
	});

	it("returns false when markdown differs", () => {
		expect(markdownPropsEqual(props(), props({ markdown: "world" }))).toBe(
			false,
		);
	});

	it("returns false when currentUsername differs", () => {
		expect(markdownPropsEqual(props(), props({ currentUsername: "bob" }))).toBe(
			false,
		);
	});

	it("returns false when useNewComposer differs", () => {
		expect(markdownPropsEqual(props(), props({ useNewComposer: true }))).toBe(
			false,
		);
	});

	it("returns false when resolveImageSrc identity differs", () => {
		expect(
			markdownPropsEqual(
				props(),
				props({ resolveImageSrc: () => Promise.resolve("y") }),
			),
		).toBe(false);
	});
});
