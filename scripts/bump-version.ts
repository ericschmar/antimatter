type PackageJson = {
	version?: unknown;
	[key: string]: unknown;
};

type ParsedVersion = {
	major: number;
	minor: number;
	patch: number;
	prerelease: string[];
	build?: string;
};

const semverPattern =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const bumpTypes = new Set([
	"major",
	"minor",
	"patch",
	"premajor",
	"preminor",
	"prepatch",
	"prerelease",
]);

const [, , requestedBump = "patch", ...rawArgs] = Bun.argv;
const packageJson = (await Bun.file("package.json").json()) as PackageJson;
const currentVersion = assertVersion(packageJson.version);
const preid =
	readOption(rawArgs, "--preid") ??
	readOption(rawArgs, "-p") ??
	currentPrereleaseId() ??
	"alpha";
const nextVersion = bumpTypes.has(requestedBump)
	? formatVersion(incrementVersion(parseVersion(currentVersion), requestedBump, preid))
	: assertVersion(requestedBump);

packageJson.version = nextVersion;
await Bun.write("package.json", `${JSON.stringify(packageJson, null, "\t")}\n`);

const electrobunConfigPath = "electrobun.config.ts";
const electrobunConfig = await Bun.file(electrobunConfigPath).text();
let replacements = 0;
const nextElectrobunConfig = electrobunConfig.replace(
	/version:\s*"([^"]+)"/,
	(match, appVersion: string) => {
		replacements += 1;
		assertVersion(appVersion);
		return match.replace(`"${appVersion}"`, `"${nextVersion}"`);
	},
);

if (replacements !== 1) {
	fail("electrobun.config.ts must declare exactly one app.version string.");
}

await Bun.write(electrobunConfigPath, nextElectrobunConfig);
console.log(`Version bumped: ${currentVersion} -> ${nextVersion}`);

function currentPrereleaseId() {
	try {
		return parseVersion(assertVersion(packageJson.version)).prerelease[0];
	} catch {
		return undefined;
	}
}

function readOption(args: string[], longName: string) {
	const optionIndex = args.findIndex((arg) => arg === longName);
	if (optionIndex >= 0) return args[optionIndex + 1];

	const prefix = `${longName}=`;
	const option = args.find((arg) => arg.startsWith(prefix));
	return option?.slice(prefix.length);
}

function assertVersion(value: unknown) {
	if (typeof value !== "string" || !semverPattern.test(value)) {
		fail(`Expected a valid SemVer string. Found: ${String(value)}`);
	}
	return value;
}

function parseVersion(version: string): ParsedVersion {
	const match = version.match(semverPattern);
	if (!match) fail(`Expected a valid SemVer string. Found: ${version}`);
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: match[4]?.split(".") ?? [],
		build: match[5],
	};
}

function incrementVersion(
	version: ParsedVersion,
	bump: string,
	preid: string,
): ParsedVersion {
	const next: ParsedVersion = { ...version, prerelease: [], build: undefined };

	if (bump === "major") return { ...next, major: next.major + 1, minor: 0, patch: 0 };
	if (bump === "minor") return { ...next, minor: next.minor + 1, patch: 0 };
	if (bump === "patch") {
		return version.prerelease.length > 0 ? next : { ...next, patch: next.patch + 1 };
	}
	if (bump === "premajor") {
		return { major: next.major + 1, minor: 0, patch: 0, prerelease: [preid, "0"] };
	}
	if (bump === "preminor") {
		return { major: next.major, minor: next.minor + 1, patch: 0, prerelease: [preid, "0"] };
	}
	if (bump === "prepatch") {
		return { major: next.major, minor: next.minor, patch: next.patch + 1, prerelease: [preid, "0"] };
	}

	const currentPreid = version.prerelease[0];
	const currentNumber = Number(version.prerelease[1]);
	const prereleaseNumber =
		currentPreid === preid && Number.isInteger(currentNumber)
			? String(currentNumber + 1)
			: "0";
	return {
		major: next.major,
		minor: next.minor,
		patch: version.prerelease.length > 0 ? next.patch : next.patch + 1,
		prerelease: [preid, prereleaseNumber],
	};
}

function formatVersion(version: ParsedVersion) {
	const core = `${version.major}.${version.minor}.${version.patch}`;
	const prerelease =
		version.prerelease.length > 0 ? `-${version.prerelease.join(".")}` : "";
	const build = version.build ? `+${version.build}` : "";
	return `${core}${prerelease}${build}`;
}

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}
