import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Antimatter",
		identifier: "antimatter.ericschmar.dev",
		version: "0.2.1",
		urlSchemes: ["mattermost-dev"],
	},
	build: {
		bun: {
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
	release: {
		baseUrl:
			"https://github.com/ericschmar/antimatter/releases/latest/download",
	},
} satisfies ElectrobunConfig;
