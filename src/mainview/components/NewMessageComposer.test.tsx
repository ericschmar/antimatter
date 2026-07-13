import { mock } from "bun:test";

const mdEditorProps: Record<string, unknown>[] = [];

mock.module("@uiw/react-md-editor", () => ({
	default: (props: Record<string, unknown>) => {
		mdEditorProps.push(props);
		return <textarea readOnly value={(props["value"] as string) ?? ""} />;
	},
}));

mock.module("@uiw/react-md-editor/markdown-editor.css", () => ({}));

const { describe, expect, test, beforeEach } = await import("bun:test");
const { renderToString } = await import("react-dom/server");
const { NewMessageComposer } = await import("./NewMessageComposer");

describe("NewMessageComposer", () => {
	beforeEach(() => {
		mdEditorProps.length = 0;
	});

	test("disables react-md-editor built-in command shortcuts", () => {
		renderToString(
			<NewMessageComposer
				composerHeight={140}
				currentUserId="user-1"
				disabled={false}
				editTarget={null}
				maxComposerHeight={320}
				mentionUsers={[]}
				replyTarget={null}
				userColors={{}}
				users={{}}
				onCancelEdit={() => {}}
				onCancelReply={() => {}}
				onEdit={async () => {}}
				onRequestComposerHeight={() => {}}
				onSend={async () => {}}
				onTyping={async () => {}}
			/>,
		);

		expect(mdEditorProps).toHaveLength(1);
		expect(mdEditorProps[0]["commands"]).toEqual([]);
		expect(mdEditorProps[0]["extraCommands"]).toEqual([]);
	});
});
