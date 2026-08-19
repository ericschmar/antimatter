import { copyFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Glob } from "bun";

// The chat history worker is built as its own electrobun "view"
// (chatHistoryWorker) so `electrobun build` emits it to
//   .../views/chatHistoryWorker/chatHistoryWorker.js
// WKWebView treats each views://<view> as a distinct origin, so fetching it
// cross-origin from the views://mainview page is blocked by CORS (issue
// antimatter-a72). Copy the built bundle into the mainview views folder so
// the main thread can fetch it same-origin:
//   views://mainview/chatHistoryWorker.js
const WORKER_REL = "views/chatHistoryWorker/chatHistoryWorker.js";
const DEST_FILENAME = "chatHistoryWorker.js";

if (import.meta.main) {
	const root = resolve(import.meta.dir, "..");
	const glob = new Glob(`{build,artifacts}/**/${WORKER_REL}`);
	const sources = [...glob.scanSync({ cwd: root })];

	if (sources.length === 0) {
		console.error(
			`[copy-chat-history-worker] No built worker found matching ${WORKER_REL} under build/ or artifacts/.`,
		);
		process.exit(1);
	}

	let copied = 0;
	for (const rel of sources) {
		const src = resolve(root, rel);
		// Target is the sibling mainview folder under the same views/ parent:
		// .../views/chatHistoryWorker/chatHistoryWorker.js
		//   -> .../views/mainview/chatHistoryWorker.js
		const viewsDir = dirname(dirname(src)); // .../views
		const mainviewDir = join(viewsDir, "mainview");
		if (!existsSync(mainviewDir)) {
			console.error(
				`[copy-chat-history-worker] mainview folder not found at ${mainviewDir}; expected the mainview view to be built already.`,
			);
			continue;
		}
		const dest = join(mainviewDir, DEST_FILENAME);
		copyFileSync(src, dest);
		copied += 1;
		console.log(`[copy-chat-history-worker] ${rel} -> ${dest}`);
	}

	if (copied === 0) {
		console.error(
			"[copy-chat-history-worker] No mainview folder was available to copy into.",
		);
		process.exit(1);
	}
}
