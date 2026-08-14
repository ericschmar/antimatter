import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = join(import.meta.dir, "..", "..");
const outDir = join(projectRoot, "build", "e2e");
const port = Number(process.env.E2E_PORT ?? 4511);

const build = Bun.spawnSync({
	cmd: [
		"bun",
		"build",
		"tests/e2e/harness/harness.tsx",
		"--outdir",
		"build/e2e",
		"--target=browser",
		"--format=esm",
		"--minify",
	],
	cwd: projectRoot,
	stderr: "pipe",
	stdout: "pipe",
});
if (!build.success) {
	console.error(build.stderr.toString());
	process.exit(1);
}

const indexHtml = readFileSync(
	join(projectRoot, "tests", "e2e", "harness", "index.html"),
	"utf8",
);

const mimeTypes: Record<string, string> = {
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
};

Bun.serve({
	port,
	fetch(request) {
		const { pathname } = new URL(request.url);
		if (pathname === "/" || pathname === "/index.html") {
			return new Response(indexHtml, {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		}
		const relative = decodeURIComponent(pathname)
			.split("../")
			.join("")
			.replace(/^\/+/, "");
		if (relative.length === 0) {
			return new Response("not found", { status: 404 });
		}
		const filePath = join(outDir, relative);
		if (!filePath.startsWith(outDir) || !existsSync(filePath)) {
			return new Response("not found", { status: 404 });
		}
		const extension = filePath.slice(filePath.lastIndexOf("."));
		return new Response(readFileSync(filePath), {
			headers: {
				"content-type": mimeTypes[extension] ?? "application/octet-stream",
			},
		});
	},
});

console.log(`[e2e] harness serving at http://127.0.0.1:${port}`);
