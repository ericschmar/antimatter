import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

describe("MainViewApp startup connection effect", () => {
	test("does not rerun when channel selection persists config changes", () => {
		const source = readFileSync(new URL("./MainViewApp.tsx", import.meta.url), "utf8");

		expect(source).toContain("void connect(config);");
		expect(source).toContain("}, []);\n\n\tuseEffect(() => {\n\t\tvoid electrobun.rpc?.request.getAppUpdateState");
		expect(source).not.toContain("}, [config, connect]);");
	});
});
