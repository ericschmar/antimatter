import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Glob } from "bun";

const PLIST_BUDDY = "/usr/libexec/PlistBuddy";
const PLIST_KEY = "NSAppNapDisabled";

export function disableAppNap(appBundlePath: string): void {
  const plist = join(appBundlePath, "Contents", "Info.plist");
  if (!existsSync(plist)) {
    throw new Error(`Info.plist not found at ${plist}`);
  }
  // Remove any existing entry so repeated runs are idempotent, then set it.
  try {
    execFileSync(PLIST_BUDDY, ["-c", `Delete :${PLIST_KEY}`, plist], {
      stdio: "ignore",
    });
  } catch {
    // Key absent on first run; safe to ignore.
  }
  execFileSync(PLIST_BUDDY, ["-c", `Add :${PLIST_KEY} bool true`, plist], {
    stdio: "ignore",
  });
}

function discoverAppBundles(rootDir: string): string[] {
  const glob = new Glob("{build,artifacts}/**/*.app");
  return [...glob.scanSync({ cwd: rootDir, onlyFiles: false })].map((p) =>
    resolve(rootDir, p),
  );
}

if (import.meta.main) {
  if (process.platform !== "darwin") {
    console.log("[disable-app-nap] Not macOS; nothing to do.");
    process.exit(0);
  }
  const root = resolve(import.meta.dir, "..");
  const apps = discoverAppBundles(root);
  if (apps.length === 0) {
    console.error(
      "[disable-app-nap] No .app bundles found under build/ or artifacts/.",
    );
    process.exit(1);
  }
  for (const app of apps) {
    disableAppNap(app);
    console.log(`[disable-app-nap] ${PLIST_KEY}=true -> ${app}`);
  }
}
