import type { ElectrobunConfig } from "electrobun";

const buildGiphyApiKey = process.env["GIPHY_API_KEY"]?.trim() ?? "";

export default {
	app: {
		name: "Antimatter",
		identifier: "antimatter.ericschmar.dev",
		version: "0.2.7",
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
