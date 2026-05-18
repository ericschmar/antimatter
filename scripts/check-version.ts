type PackageJson = {
	version?: unknown;
};

const semverPattern =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const packageJson = (await Bun.file("package.json").json()) as PackageJson;
const packageVersion = packageJson.version;

if (typeof packageVersion !== "string" || !semverPattern.test(packageVersion)) {
	fail(`package.json version must be a valid SemVer string. Found: ${String(packageVersion)}`);
}

const electrobunConfig = await Bun.file("electrobun.config.ts").text();
const appVersionMatch = electrobunConfig.match(/version:\s*"([^"]+)"/);
const appVersion = appVersionMatch?.[1];

if (!appVersion) {
	fail("electrobun.config.ts must declare app.version.");
}

if (appVersion !== packageVersion) {
	fail(
		`package.json version (${packageVersion}) must match electrobun.config.ts app.version (${appVersion}).`,
	);
}

const refName = Bun.env["GITHUB_REF_NAME"];
const refType = Bun.env["GITHUB_REF_TYPE"];

if (refType === "tag" && refName) {
	const tagMatch = refName.match(/^v(.+)$/);
	if (!tagMatch || !semverPattern.test(tagMatch[1])) {
		fail(`release tags must use SemVer format like v1.2.3. Found: ${refName}`);
	}

	if (tagMatch[1] !== packageVersion) {
		fail(
			`release tag (${refName}) must match package.json version (${packageVersion}).`,
		);
	}
}

console.log(`Version check passed: ${packageVersion}`);

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

