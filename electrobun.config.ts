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
		// Preserve the v1 Bun main process during the v2 migration. The
		// existing main process uses Bun APIs and can move to Cottontail
		// independently.
		mainProcess: "bun",
		bun: {
			define: {
				__ANTIMATTER_GIPHY_API_KEY__: JSON.stringify(buildGiphyApiKey),
			},
			entrypoint: "src/bun/index.ts",
		},
		views: {
			mainview: {
				entrypoint: "src/mainview/index.tsx",
				// Third-party renderer dependencies remain React-oriented;
				// ship them on Preact's compatibility runtime instead.
				alias: {
				        react: "preact/compat",
				        "react-dom": "preact/compat",
				        "react-dom/client": "preact/compat/client",
				        "react-dom/test-utils": "preact/test-utils",
				        "react/jsx-runtime": "preact/jsx-runtime",
				},
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
			// CSS @imports are resolved by the WebKit view rather than
			// transformed by `build.copy`. Keep imported stylesheets under
			// the same paths the view resolves from `index.css`.
			"node_modules/@radix-ui/colors/grass-dark.css":
				"views/mainview/@radix-ui/colors/grass-dark.css",
			"node_modules/@radix-ui/colors/slate-dark.css":
				"views/mainview/@radix-ui/colors/slate-dark.css",
			"node_modules/@radix-ui/colors/amber-dark.css":
				"views/mainview/@radix-ui/colors/amber-dark.css",
			"node_modules/@radix-ui/colors/red-dark.css":
				"views/mainview/@radix-ui/colors/red-dark.css",
			"node_modules/dockview-react/dist/styles/dockview.css":
				"views/mainview/dockview-react/dist/styles/dockview.css",
			"node_modules/react-resizable/css/styles.css":
				"views/mainview/react-resizable/css/styles.css",
			"node_modules/@iamjariwala/react-doc-viewer/dist/index.css":
				"views/mainview/@iamjariwala/react-doc-viewer/dist/index.css",
			"node_modules/@mdxeditor/editor/dist/style.css":
				"views/mainview/@mdxeditor/editor/style.css",
			"node_modules/@uiw/react-markdown-preview/markdown.css":
				"views/mainview/@uiw/react-markdown-preview/markdown.css",
			"node_modules/@uiw/react-md-editor/markdown-editor.css":
				"views/mainview/@uiw/react-md-editor/markdown-editor.css",
			"src/mainview/components/AuthScreen.css":
				"views/mainview/components/AuthScreen.css",
			"src/mainview/components/MessageComposer.css":
				"views/mainview/components/MessageComposer.css",
			"src/mainview/components/MessageTimeline.css":
				"views/mainview/components/MessageTimeline.css",
			"src/mainview/components/NewMessageComposer.css":
				"views/mainview/components/NewMessageComposer.css",
			"src/mainview/components/PollDialog.css":
				"views/mainview/components/PollDialog.css",
			"src/mainview/components/Sidebar.css":
				"views/mainview/components/Sidebar.css",
			"src/mainview/components/Titlebar.css":
				"views/mainview/components/Titlebar.css",
			"src/mainview/components/WebRTCCallUI.css":
			        "views/mainview/components/WebRTCCallUI.css",
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
