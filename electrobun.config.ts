import type { ElectrobunConfig } from "electrobun";

const buildGiphyApiKey = process.env["GIPHY_API_KEY"]?.trim() ?? "";

export default {
	app: {
		name: "Antimatter",
		identifier: "antimatter.ericschmar.dev",
		version: "0.4.0",
		urlSchemes: ["mattermost-dev"],
	},
	build: {
		bun: {
			define: {
				__ANTIMATTER_GIPHY_API_KEY__: JSON.stringify(buildGiphyApiKey),
			},
			entrypoint: "src/bun/index.ts",
		},
		views: {
			mainview: {
				entrypoint: "src/mainview/index.tsx",
			},
			// Build-only "view": the chat history web worker. Bundled as an
			// IIFE next to the mainview bundle so the main thread can fetch it
			// and spawn a blob-URL classic worker (WKWebView does not resolve
			// `new Worker(new URL(...))` module refs through Bun.build).
			chatHistoryWorker: {
				entrypoint: "src/mainview/workers/chatHistoryWorker.ts",
				format: "iife",
			},
			childview: {
				entrypoint: "src/childview/index.ts",
			},
		},
		copy: {
			"src/mainview/index.html": "views/mainview/index.html",
			"src/mainview/index.css": "views/mainview/index.css",
			"src/childview/index.html": "views/childview/index.html",
			"src/childview/index.css": "views/childview/index.css",
			"node_modules/font-list/libs": "bun/libs",
		},
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: true,
		},
		win: {
			bundleCEF: false,
		},
	},
	scripts: {
		// Copy the built chat history worker bundle into the mainview views
		// folder so the main thread can fetch it same-origin
		// (views://mainview/chatHistoryWorker.js). WKWebView blocks the
		// cross-origin fetch from views://mainview to views://chatHistoryWorker
		// (issue antimatter-a72). Runs after views are built, before wrapping.
		postBuild: "scripts/copy-chat-history-worker.ts",
		// Disable macOS App Nap so the bun process keeps forwarding WebSocket
		// events (and the mainview keeps processing them) while the app is in
		// the background, instead of delivering a burst on focus.
		// See issue antimatter-vkb.
		postWrap: "scripts/disable-app-nap.ts",
	},
	release: {
		baseUrl:
			"https://github.com/ericschmar/antimatter/releases/latest/download",
	},
} satisfies ElectrobunConfig;
