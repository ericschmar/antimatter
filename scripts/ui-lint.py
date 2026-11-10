#!/usr/bin/env python3
"""Headless UI lint: render scenes at several sizes and fail on layout defects the tree proves.

PNGs land in build/ui/ for visual inspection; the lint is not visual proof. Stdlib only.
Usage: ui-lint.py [--self-test] [--scene NAME ...] [--size WxH ...]
"""
import argparse, json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "build/ui"
SCENES = ["signin-proof", "signin-password-proof", "signin-sso-proof", "workspace-proof", "workspace-locked-proof", "workspace-retry-proof",
          "signin-light-proof", "signin-contrast-proof", "signin-warm-proof", "workspace-light-proof", "workspace-contrast-proof", "workspace-warm-proof"]
SIZES = ["420x400", "640x480", "960x640", "1280x800"]
EPS = 0.5


def invisible(fill):
    return fill is None or str(fill).endswith("00000000")


def lint(tree, chrome_stderr=""):
    """Human-readable defects for one rendered tree (empty list = clean)."""
    found = [f"warning: {w}" for w in tree.get("warnings", [])]
    found += [l.strip() for l in chrome_stderr.splitlines() if "overlaps the traffic lights" in l]
    vw, vh = tree["viewport"]
    els = [e for e in tree["elements"] if "rect" in e]
    by_path = {e["path"]: e for e in els}
    scrolls = [e["path"] + "/" for e in els if e.get("key") == "timeline" or str(e.get("key")).endswith("-scroll")]
    boxed = [e["path"] + "/" for e in els if e.get("role") == "textbox" and not invisible(e.get("fill"))]
    for e in els:
        x, y, w, h = e["rect"]
        if w <= 0 or h <= 0:
            continue
        name = e.get("key") or e.get("text") or e["path"]
        role = e.get("role")
        if x + w > vw + EPS and role != "separator":
            found.append(f"overflows window right: {name!r} ends {x + w:.0f} > {vw:.0f}")
        scrolled = any(e["path"].startswith(p) for p in scrolls)
        if role in ("text", "button", "textbox") and y + h > vh + EPS and not scrolled:
            found.append(f"overflows window bottom: {name!r} ends {y + h:.0f} > {vh:.0f}")
        if role == "button":
            p = by_path.get(e["path"].rsplit("/", 1)[0])
            if p and p["rect"][2] > 0 and x + w > p["rect"][0] + p["rect"][2] + EPS:
                found.append(f"button escapes parent: {name!r} ends {x + w:.0f}, parent {p['rect'][0] + p['rect'][2]:.0f}")
        if role == "text" and e.get("text"):
            p = by_path.get(e["path"].rsplit("/", 1)[0])
            if p and x + w > p["rect"][0] + p["rect"][2] + EPS:
                found.append(f"text escapes parent: {name!r} ends {x + w:.0f}, parent {p['rect'][0] + p['rect'][2]:.0f}")
        if role == "textbox" and not e.get("inert") and invisible(e.get("fill")) and not e.get("border") \
                and not any(e["path"].startswith(p) for p in boxed):
            found.append(f"textbox {name!r} has no fill or border: invisible input")
        if role == "button" and invisible(e.get("fill")) and not e.get("border") and w > vw * 0.9:
            found.append(f"button {name!r} spans {w:.0f}pt with no fill: floating label")
    texts = [e for e in els if e.get("role") == "text" and e.get("text") and e["rect"][2] > 0 and e["rect"][3] > 0]
    for i, a in enumerate(texts):
        for b in texts[i + 1:]:
            ax, ay, aw, ah = a["rect"]
            bx, by, bw, bh = b["rect"]
            if min(ax + aw, bx + bw) - max(ax, bx) > 1 and min(ay + ah, by + bh) - max(ay, by) > 2:
                found.append(f"text overlaps text: {a['text']!r} / {b['text']!r}")
    return found


def render(scene, size):
    stem = f"{scene}-{size}"
    tree, png = OUT / f"{stem}.json", OUT / f"{stem}.png"
    cmd = ["cargo", "run", "-q", "--locked", "--offline", "--", "--scene", scene, "--size", size,
           "--at", "1", "--chrome", "--tree", str(tree), "--snap", str(png)]
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"render failed for {stem}:\n{r.stderr}")
    return json.loads(tree.read_text()), r.stderr, png


def self_test():
    text = lambda p, rect, t: {"path": p, "rect": rect, "role": "text", "text": t}
    ok = {"viewport": [100, 100], "elements": [
        {"path": "#0", "rect": [0, 0, 100, 100], "role": "group"}, text("#0/#0", [0, 0, 50, 10], "a")]}
    assert lint(ok) == []
    wide = {"viewport": [100, 100], "elements": [
        {"path": "#0", "rect": [0, 0, 100, 100], "role": "group"}, text("#0/#0", [90, 0, 50, 10], "a")]}
    d = lint(wide)
    assert any("overflows window right" in x for x in d) and any("escapes parent" in x for x in d)
    box = {"viewport": [100, 100], "elements": [
        {"path": "#0/f", "key": "f", "rect": [0, 0, 50, 20], "role": "textbox", "fill": "#00000000"}]}
    assert any("invisible input" in x for x in lint(box))
    btn = {"viewport": [100, 100], "elements": [
        {"path": "#0/b", "key": "b", "rect": [0, 0, 96, 20], "role": "button", "fill": "#00000000"}]}
    assert any("floating label" in x for x in lint(btn))
    two = {"viewport": [100, 100], "elements": [text("#0/a", [0, 0, 50, 12], "a"), text("#0/b", [10, 0, 50, 12], "b")]}
    assert any("overlaps" in x for x in lint(two))
    assert lint(ok, "rune: chrome: #0 overlaps the traffic lights at [1]")
    print("ui-lint self-test passed")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--scene", action="append")
    ap.add_argument("--size", action="append")
    a = ap.parse_args()
    if a.self_test:
        return self_test()
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for scene in a.scene or SCENES:
        for size in a.size or SIZES:
            tree, err, png = render(scene, size)
            defects = sorted(set(lint(tree, err)))
            total += len(defects)
            print(f"{'FAIL' if defects else 'ok  '} {scene} @ {size}  {png.relative_to(ROOT)}")
            for d in defects:
                print(f"       - {d}")
    print(f"\n{total} defect(s). Still inspect the PNGs.")
    sys.exit(1 if total else 0)


if __name__ == "__main__":
    main()
