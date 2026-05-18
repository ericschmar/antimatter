import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Antimatter",
		identifier: "antimatter.ericschmar.dev",
		version: "1.0.0",
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
			// ElectroBun defaults to icon.iconset, but that folder is not iconutil-clean yet.
			// Point at a non-existent iconset so packaging can proceed without a custom icon.
			icons: "assets/antimatter.iconset",
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
	},
} satisfies ElectrobunConfig;
