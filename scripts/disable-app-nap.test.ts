import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { test, expect } from "bun:test";
import { disableAppNap } from "./disable-app-nap";

const isMac = process.platform === "darwin";
const PLIST_BUDDY = "/usr/libexec/PlistBuddy";

const MINIMAL_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>test.AntimatterFake</string>
</dict>
</plist>
`;

function makeFakeApp(): string {
  const dir = mkdtempSync(join(tmpdir(), "antimatter-nap-"));
  const app = join(dir, "Fake.app");
  mkdirSync(join(app, "Contents"), { recursive: true });
  writeFileSync(join(app, "Contents", "Info.plist"), MINIMAL_PLIST);
  return app;
}

function readKey(appBundlePath: string, key: string): string {
  const plist = join(appBundlePath, "Contents", "Info.plist");
  return execFileSync(PLIST_BUDDY, ["-c", `Print :${key}`, plist], {
    encoding: "utf8",
  }).trim();
}

test.skipIf(!isMac)(
  "disableAppNap sets NSAppNapDisabled to true on a built app bundle",
  () => {
    const app = makeFakeApp();
    try {
      disableAppNap(app);
      expect(readKey(app, "NSAppNapDisabled")).toBe("true");
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  },
);

test.skipIf(!isMac)("disableAppNap is idempotent across repeated calls", () => {
  const app = makeFakeApp();
  try {
    disableAppNap(app);
    expect(() => disableAppNap(app)).not.toThrow();
    expect(readKey(app, "NSAppNapDisabled")).toBe("true");
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});

test.skipIf(!isMac)(
  "disableAppNap preserves an existing CFBundleIdentifier",
  () => {
    const app = makeFakeApp();
    try {
      disableAppNap(app);
      expect(readKey(app, "CFBundleIdentifier")).toBe("test.AntimatterFake");
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  },
);
